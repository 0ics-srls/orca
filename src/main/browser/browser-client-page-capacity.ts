import { BROWSER_CLIENT_HOST_PAGE_INVENTORY_MAX_PAGES } from '../../shared/browser-client-host-protocol'

export function resolveBrowserClientPageLimit(value: number | undefined): number {
  const limit = value ?? BROWSER_CLIENT_HOST_PAGE_INVENTORY_MAX_PAGES
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > BROWSER_CLIENT_HOST_PAGE_INVENTORY_MAX_PAGES
  ) {
    throw new Error('browser_client_page_limit_invalid')
  }
  return limit
}
