#!/usr/bin/env node

const {
    getSmtpConfig,
    sendEmail,
    verifySmtpConnection
} = require('./smtp-mailer');

function getArg(name) {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
    const shouldVerify = process.argv.includes('--verify');
    const to = getArg('to');
    const subject = getArg('subject');
    const body = getArg('body');

    if (process.argv.includes('--check-config')) {
        const config = getSmtpConfig();

        console.log(JSON.stringify({
            enabled: config.enabled,
            host: config.host,
            port: config.port,
            from: config.from,
            username: config.username,
            passwordLoaded: Boolean(config.password),
            tls: 'STARTTLS'
        }, null, 2));

        return;
    }

    if (shouldVerify) {
        await verifySmtpConnection();
        console.log('SMTP connection verified with STARTTLS and authentication.');

        return;
    }

    if (!to || !subject || !body) {
        console.error('Usage: node scripts/send-email.js --to recipient@example.com --subject "Subject" --body "Body"');
        process.exitCode = 1;

        return;
    }

    await sendEmail({ body, subject, to });
    console.log(`Email sent to ${to}.`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
