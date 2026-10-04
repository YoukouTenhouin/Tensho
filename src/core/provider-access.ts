/** Provider declarations use concrete HTTP(S) hosts. Browser removal events may
 * cover a whole scheme or wildcard subdomain; host-permission paths are ignored. */
export function providerAccessRemoved(required: readonly string[], removed: readonly string[]): boolean {
  return required.some(origin => {
    let provider: URL;
    try { provider = new URL(origin); } catch { return false; }
    if (!['http:', 'https:'].includes(provider.protocol)) return false;
    return removed.some(pattern => {
      if (pattern === '<all_urls>') return true;
      const match = /^(\*|https?):\/\/([^/]+)\//.exec(pattern);
      if (!match || (match[1] !== '*' && `${match[1]}:` !== provider.protocol)) return false;
      const authority = match[2]!, subdomains = authority.startsWith('*.');
      let host: URL;
      try { host = new URL(`${provider.protocol}//${authority.replace(/^\*\./, '').replace(/:\*$/, '')}/`); }
      catch { return false; }
      const port = /:(\d+)$/.exec(authority)?.[1];
      if (port && Number(port) !== Number(provider.port || (provider.protocol === 'https:' ? 443 : 80))) return false;
      return host.hostname === '*' || provider.hostname === host.hostname || (subdomains && provider.hostname.endsWith(`.${host.hostname}`));
    });
  });
}
