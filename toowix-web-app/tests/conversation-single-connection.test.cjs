const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ConversationsPanel.tsx'), 'utf8');

assert.match(source, /const handleStartConversationCall = \(\) => \{[\s\S]*?navigate\(`\/meet\/\$\{encodeURIComponent\(selectedConversation\.roomSlug\)\}\?fromConversation=1`\)/, 'conversation call must navigate straight to one meeting route');
assert.match(source, /onClick=\{handleStartConversationCall\}/, 'the Start / Join call button must not open an embedded meeting first');
assert.doesNotMatch(source, /onClick=\{\(\) => setCallOpen\(true\)\}/, 'no conversation action may create an iframe call before navigation');

console.log('PASS conversation calls start one conference connection');
