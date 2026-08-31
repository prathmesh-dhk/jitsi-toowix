const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');

const DEFAULT_TIMEOUT_MS = 15000;

function loadDotEnv(envPath = path.resolve(process.cwd(), '.env')) {
    if (!fs.existsSync(envPath)) {
        return;
    }

    const envContent = fs.readFileSync(envPath, 'utf8');

    envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }

        const eqIdx = trimmed.indexOf('=');

        if (eqIdx === -1) {
            return;
        }

        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim().replace(/^["'](.*)["']$/, '$1');

        if (key && !(key in process.env)) {
            process.env[key] = value;
        }
    });
}

function isSmtpEnabled(value = process.env.SMTP_ENABLE) {
    return String(value).toLowerCase() === 'true';
}

function getSmtpConfig() {
    loadDotEnv();

    const config = {
        enabled: isSmtpEnabled(),
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        from: process.env.SMTP_USER_EMAIL || process.env.SMTP_USERNAME,
        username: process.env.SMTP_USERNAME || process.env.SMTP_USER_EMAIL,
        password: process.env.SMTP_PASS,
        timeoutMs: Number(process.env.SMTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
    };

    const missing = [];

    if (!config.enabled) {
        missing.push('SMTP_ENABLE=true');
    }

    if (!config.host) {
        missing.push('SMTP_HOST');
    }

    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
        missing.push('SMTP_PORT');
    }

    if (!config.from) {
        missing.push('SMTP_USER_EMAIL');
    }

    if (!config.username) {
        missing.push('SMTP_USERNAME');
    }

    if (!config.password) {
        missing.push('SMTP_PASS');
    }

    if (missing.length) {
        throw new Error(`SMTP is not configured correctly. Missing/invalid: ${missing.join(', ')}`);
    }

    return config;
}

function sanitizeSmtpError(error) {
    const message = error instanceof Error ? error.message : String(error);

    return new Error(message.replace(process.env.SMTP_PASS || '__NO_SMTP_PASS__', '[redacted]'));
}

function validateEmailAddress(value, fieldName) {
    if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new Error(`${fieldName} must be a valid email address`);
    }
}

function encodeHeader(value) {
    const normalized = String(value || '').replace(/[\r\n]+/g, ' ').trim();

    return /[^\x20-\x7E]/.test(normalized)
        ? `=?UTF-8?B?${Buffer.from(normalized, 'utf8').toString('base64')}?=`
        : normalized;
}

function dotStuff(value) {
    return String(value).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function buildMessage({ body, from, subject, to }) {
    const date = new Date().toUTCString();
    const safeSubject = encodeHeader(subject);
    const textBody = dotStuff(body);

    return [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${safeSubject}`,
        `Date: ${date}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        textBody
    ].join('\r\n');
}

class SmtpClient {
    constructor(config) {
        this.config = config;
        this.buffer = '';
        this.socket = undefined;
    }

    async connect() {
        this.socket = net.createConnection({
            host: this.config.host,
            port: this.config.port
        });

        this.socket.setEncoding('utf8');
        this.socket.setTimeout(this.config.timeoutMs);
        this.socket.on('data', data => {
            this.buffer += data;
        });

        this.socket.on('timeout', () => {
            this.socket.destroy(new Error('SMTP connection timed out'));
        });

        await new Promise((resolve, reject) => {
            this.socket.once('connect', resolve);
            this.socket.once('error', reject);
        });

        await this.expect([ 220 ]);
        await this.command(`EHLO ${this.localName()}`, [ 250 ]);
        await this.command('STARTTLS', [ 220 ]);
        await this.upgradeToTls();
        await this.command(`EHLO ${this.localName()}`, [ 250 ]);
        await this.command('AUTH LOGIN', [ 334 ]);
        await this.command(Buffer.from(this.config.username, 'utf8').toString('base64'), [ 334 ]);
        await this.command(Buffer.from(this.config.password, 'utf8').toString('base64'), [ 235 ]);
    }

    async verify() {
        await this.connect();
        await this.quit();
    }

    async send({ body, subject, to }) {
        validateEmailAddress(to, 'Recipient email');

        if (typeof subject !== 'string' || !subject.trim()) {
            throw new Error('Subject is required');
        }

        if (typeof body !== 'string' || !body.trim()) {
            throw new Error('Email body is required');
        }

        await this.connect();
        await this.command(`MAIL FROM:<${this.config.from}>`, [ 250 ]);
        await this.command(`RCPT TO:<${to}>`, [ 250, 251 ]);
        await this.command('DATA', [ 354 ]);
        await this.command(`${buildMessage({
            body,
            from: this.config.from,
            subject,
            to
        })}\r\n.`, [ 250 ]);
        await this.quit();
    }

    async quit() {
        if (!this.socket || this.socket.destroyed) {
            return;
        }

        try {
            await this.command('QUIT', [ 221 ]);
        } finally {
            this.socket.end();
        }
    }

    async upgradeToTls() {
        const oldSocket = this.socket;

        oldSocket.removeAllListeners('data');

        this.buffer = '';
        this.socket = tls.connect({
            socket: oldSocket,
            servername: this.config.host
        });
        this.socket.setEncoding('utf8');
        this.socket.setTimeout(this.config.timeoutMs);
        this.socket.on('data', data => {
            this.buffer += data;
        });

        await new Promise((resolve, reject) => {
            this.socket.once('secureConnect', resolve);
            this.socket.once('error', reject);
        });
    }

    async command(command, expectedCodes) {
        this.socket.write(`${command}\r\n`);

        return this.expect(expectedCodes);
    }

    async expect(expectedCodes) {
        const response = await this.readResponse();
        const code = Number(response.slice(0, 3));

        if (!expectedCodes.includes(code)) {
            throw new Error(`SMTP command failed with code ${code}: ${response.split(/\r?\n/)[0]}`);
        }

        return response;
    }

    readResponse() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => cleanupReject(new Error('SMTP response timed out')), this.config.timeoutMs);

            const cleanup = () => {
                clearTimeout(timeout);
                this.socket.off('data', onData);
                this.socket.off('error', cleanupReject);
                this.socket.off('close', onClose);
            };

            const cleanupReject = error => {
                cleanup();
                reject(error);
            };

            const onClose = () => cleanupReject(new Error('SMTP connection closed unexpectedly'));

            const onData = () => {
                const complete = this.buffer.match(/(?:^|\r?\n)(\d{3}) .*(?:\r?\n|$)/);

                if (!complete) {
                    return;
                }

                const response = this.buffer.slice(0, complete.index + complete[0].length);

                this.buffer = this.buffer.slice(complete.index + complete[0].length);
                cleanup();
                resolve(response.trimEnd());
            };

            this.socket.on('data', onData);
            this.socket.once('error', cleanupReject);
            this.socket.once('close', onClose);
            onData();
        });
    }

    localName() {
        return 'localhost';
    }
}

async function verifySmtpConnection() {
    try {
        const client = new SmtpClient(getSmtpConfig());

        await client.verify();
    } catch (error) {
        throw sanitizeSmtpError(error);
    }
}

async function sendEmail({ body, subject, to }) {
    try {
        const config = getSmtpConfig();

        validateEmailAddress(config.from, 'Sender email');

        const client = new SmtpClient(config);

        await client.send({ body, subject, to });
    } catch (error) {
        throw sanitizeSmtpError(error);
    }
}

module.exports = {
    getSmtpConfig,
    isSmtpEnabled,
    loadDotEnv,
    sendEmail,
    verifySmtpConnection
};
