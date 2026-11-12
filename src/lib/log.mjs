const TTY = process.stdout.isTTY;
const paint = (code) => (s) => (TTY ? `\u001b[${code}m${s}\u001b[0m` : String(s));
export const c = {
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('36'),
  bold: paint('1'),
};
export const created = [];
export function log(msg, ...rest) {
  console.log(c.dim('·'), msg, ...rest);
}
export function info(msg, ...rest) {
  console.log(c.blue('›'), msg, ...rest);
}
export function ok(msg, ...rest) {
  console.log(c.green('✓'), msg, ...rest);
}
export function warn(msg, ...rest) {
  console.log(c.yellow('!'), msg, ...rest);
}
export function fail(msg, ...rest) {
  console.error(c.red('✗'), msg, ...rest);
}
export function head(title) {
  console.log('');
  console.log(c.bold(title));
  console.log(c.dim('─'.repeat(Math.min(72, Math.max(24, title.length + 4)))));
}
