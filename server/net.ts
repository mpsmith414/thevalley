import os from 'node:os';

const isPrivate = (a: string) => {
  const [p, q] = a.split('.').map(Number);
  return p === 10 || (p === 192 && q === 168) || (p === 172 && q >= 16 && q <= 31);
};

/** The first private IPv4 (192.168/16, 10/8, 172.16/12) of this machine, or `override`, or 'localhost'. */
export function lanHost(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>, override?: string): string {
  if (override?.trim()) return override.trim();
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) if ((i.family === 'IPv4' || (i.family as unknown) === 4) && !i.internal && isPrivate(i.address)) return i.address;
  }
  return 'localhost';
}

/** Where a phone opens the companion page: the join code rides in the link so the QR code is all a kid needs. */
export function phoneUrl(host: string, port: number, code: string): string {
  return `http://${host}:${port}/phone.html?c=${code}`;
}

/** The address phones should use: `PHONE_HOST` in `.env` (or the environment) overrides the detected LAN address. */
export function phoneHost(env: NodeJS.ProcessEnv, ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string {
  return lanHost(ifaces, env.PHONE_HOST);
}
