// Filesystem protection for the files this tool writes: Production exports, Development backups, Stripe-reference reports,
// customer id lists, and the file that holds database credentials. They hold real customer data or secrets, so they are readable by the
// current user only. Windows: inherited access is removed and only the current user is granted (icacls). POSIX: mode 700 / 600.
// Nothing here ever deletes anything; deletion is a separate, explicit command (retention.mjs).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';

export function currentPrincipal() {
  if (WIN && process.env.USERNAME) return process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
  return os.userInfo().username;
}

// Broad groups that would let other accounts on this machine read the data.
const BROAD = [/^everyone$/i, /(^|\\)users$/i, /authenticated users$/i, /(^|\\)domain users$/i, /\\interactive$/i, /^\*?s-1-1-0$/i, /^\*?s-1-5-32-545$/i];

// The principals that can access a path.
export function accessList(p) {
  if (WIN) {
    const r = spawnSync('icacls', [p], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Could not read the access list of ${p}: ${(r.stderr || r.stdout || '').trim()}`);
    const out = [];
    const text = r.stdout.replace(/\r/g, '');
    const block = text.split(/\n\s*\n/)[0];
    let first = true;
    for (let line of block.split('\n')) {
      if (first) {
        line = line.startsWith(p) ? line.slice(p.length) : line.replace(/^.*?\s(\S+:\()/, '$1');
        first = false;
      }
      const m = line.trim().match(/^(.*?):\(/);
      if (m) out.push(m[1].trim());
    }
    return out;
  }
  const mode = fs.statSync(p).mode & 0o777;
  return (mode & 0o077) === 0 ? [currentPrincipal()] : ['group/other (mode ' + mode.toString(8) + ')'];
}

export function isRestricted(p) {
  if (!fs.existsSync(p)) return false;
  if (!WIN) return (fs.statSync(p).mode & 0o077) === 0;
  const principals = accessList(p);
  return principals.length > 0 && !principals.some((x) => BROAD.some((re) => re.test(x)));
}

// This module changes access lists. It must never be pointed at a system, user-profile or shared folder (or a drive root, or any ancestor of
// one): those are not folders the tool created, and restricting them would affect other programs and accounts.
export function assertOwnFolder(p, deps = {}) {
  // The folder is judged by where it REALLY is: a link (junction or symlink) that points at a system folder is refused too.
  const real = deps.realpath ?? fs.realpathSync;
  for (const candidate of new Set([path.resolve(p), fs.existsSync(p) ? real(p) : path.resolve(p)])) assertNotShared(candidate);
  return path.resolve(p);
}

function assertNotShared(abs) {
  const norm = (x) => path.resolve(x).toLowerCase();
  const shared = [os.homedir(), os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.USERPROFILE, process.env.LOCALAPPDATA, process.env.APPDATA, process.env.ProgramData, process.env.SystemRoot, process.env.SystemDrive && process.env.SystemDrive + path.sep, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], '/', '/tmp', '/etc', '/usr', '/var', '/home', '/root']
    .filter(Boolean)
    .map(norm);
  const a = abs.toLowerCase();
  if (path.parse(abs).root.toLowerCase() === a || shared.some((f) => a === f || f.startsWith(a + path.sep))) {
    throw new Error(`Refusing to change who can access ${abs}: it is a system, profile, temporary or shared folder, not a folder this tool created.`);
  }
}

// `deps` lets a test observe (or replace) the two things that change permissions, so a test can prove a refusal without being able to change a
// real folder if the guard ever regressed.
export function protectPath(p, deps = {}) {
  assertOwnFolder(p, deps);
  const run = deps.spawn ?? spawnSync;
  const chmod = deps.chmod ?? fs.chmodSync;
  const isDir = fs.statSync(p).isDirectory();
  if (WIN) {
    const grant = `${currentPrincipal()}:${isDir ? '(OI)(CI)F' : 'F'}`;
    const r = run('icacls', [p, '/inheritance:r', '/grant:r', grant], { encoding: 'utf8' });
    // Explicit entries survive the removal of inheritance (for example a broad group someone granted to this very file): remove every
    // principal except the current user.
    for (const who of accessList(p)) {
      if (who.toLowerCase() === currentPrincipal().toLowerCase()) continue;
      run('icacls', [p, '/remove:g', who], { encoding: 'utf8' });
    }
    return { ok: r.status === 0 && isRestricted(p), detail: (r.stderr || '').trim() };
  }
  chmod(p, isDir ? 0o700 : 0o600);
  return { ok: isRestricted(p), detail: '' };
}

// POSIX only: files created by other programs (psql \copy) follow the umask; tighten them. On Windows the folder's access list is inherited.
export function hardenTree(dir) {
  if (WIN || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      fs.chmodSync(p, 0o700);
      hardenTree(p);
    } else fs.chmodSync(p, 0o600);
  }
}

// Creates (if needed) and protects a folder; refuses to continue if it can not be made private.
export function ensureProtectedDir(dir, deps = {}) {
  assertOwnFolder(dir, deps);
  (deps.mkdir ?? fs.mkdirSync)(dir, { recursive: true, mode: 0o700 });
  // Always applied (not only when broad access is found): the folder ends up readable by the current user and nobody else.
  const r = protectPath(dir, deps);
  if (!r.ok) throw new Error(`Could not restrict ${dir} to the current user (${r.detail || 'access list still broad'}). Refusing to write customer data there.`);
  return dir;
}

export function assertRestricted(p, what) {
  if (!isRestricted(p)) throw new Error(`${what} (${p}) is readable by other accounts on this machine. Run: npm run syncDevDataFromProd -- protect`);
}
