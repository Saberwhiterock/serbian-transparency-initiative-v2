const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const empty = { reports: [], evidence: [], contacts: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function write(data) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  addReport(report) {
    const data = read();
    report.id = data.reports.length + 1;
    report.status = 'pending';
    report.created_at = new Date().toISOString();
    data.reports.push(report);
    write(data);
    return report;
  },

  addEvidence(evidence) {
    const data = read();
    evidence.id = data.evidence.length + 1;
    evidence.status = 'pending';
    evidence.created_at = new Date().toISOString();
    data.evidence.push(evidence);
    write(data);
    return evidence;
  },

  addContact(contact) {
    const data = read();
    contact.id = data.contacts.length + 1;
    contact.status = 'unread';
    contact.created_at = new Date().toISOString();
    data.contacts.push(contact);
    write(data);
    return contact;
  },

  getAll() {
    return read();
  }
};
