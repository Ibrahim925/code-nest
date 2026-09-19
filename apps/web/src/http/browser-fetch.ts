export function browserFetch(fetcher?: typeof fetch): typeof fetch {
  return fetcher ?? globalThis.fetch.bind(globalThis);
}
