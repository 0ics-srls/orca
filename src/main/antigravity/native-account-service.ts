import { createHash } from 'node:crypto'
import {
  parseAntigravityNativeCredential,
  type AntigravityNativeCredential
} from './native-credential-codec'

export type AntigravityAccountSummary = {
  id: string
  email: string | null
  subject: string | null
  authMethod: string
  createdAt: number
  updatedAt: number
}

type StoredAccount = AntigravityAccountSummary & { credentials: string }

export type AntigravityAccountStore = {
  read(): StoredAccount[]
  write(accounts: StoredAccount[]): void
}

export type AntigravityCredentialBackend = {
  read(): Promise<AntigravityNativeCredential | null>
  write(contents: string): Promise<void>
}

export type AntigravityAccountState = {
  accounts: AntigravityAccountSummary[]
  activeAccountId: string | null
}

function accountId(contents: string): string {
  return `antigravity-${createHash('sha256').update(contents).digest('hex').slice(0, 16)}`
}

function summary(account: StoredAccount): AntigravityAccountSummary {
  const { credentials: _credentials, ...result } = account
  return result
}

/** Owns account identity and switching; quota fetch failures never alter this state. */
export class AntigravityAccountService {
  private activeAccountId: string | null = null

  constructor(
    private readonly store: AntigravityAccountStore,
    private readonly credentialBackend: AntigravityCredentialBackend,
    private readonly now: () => number = Date.now
  ) {}

  async listAccounts(): Promise<AntigravityAccountState> {
    const accounts = this.store.read()
    const active = await this.knownActiveAccount(accounts)
    this.activeAccountId = active?.id ?? null
    return { accounts: accounts.map(summary), activeAccountId: this.activeAccountId }
  }

  async addCurrentAccount(): Promise<AntigravityAccountState> {
    const current = await this.credentialBackend.read()
    if (!current) {
      throw new Error('No native Antigravity account is signed in.')
    }
    const id = accountId(current.contents)
    const accounts = this.store.read()
    const timestamp = this.now()
    const next: StoredAccount = {
      id,
      email: current.identity?.email ?? null,
      subject: current.identity?.subject ?? null,
      authMethod: current.authMethod,
      createdAt: accounts.find((account) => account.id === id)?.createdAt ?? timestamp,
      updatedAt: timestamp,
      credentials: current.contents
    }
    this.store.write([...accounts.filter((account) => account.id !== id), next])
    this.activeAccountId = id
    return this.listAccounts()
  }

  async selectAccount(id: string): Promise<AntigravityAccountState> {
    const accounts = this.store.read()
    const selected = accounts.find((account) => account.id === id)
    if (!selected) {
      throw new Error('Antigravity account was not found.')
    }
    // Validate before replacing the live credential; stored records may outlive a CLI upgrade.
    parseAntigravityNativeCredential(selected.credentials)
    await this.credentialBackend.write(selected.credentials)
    const readback = await this.credentialBackend.read()
    if (readback?.contents !== selected.credentials) {
      throw new Error('Antigravity account switching could not be verified.')
    }
    this.activeAccountId = id
    return { accounts: accounts.map(summary), activeAccountId: id }
  }

  async removeAccount(id: string): Promise<AntigravityAccountState> {
    const accounts = this.store.read()
    if (!accounts.some((account) => account.id === id)) {
      throw new Error('Antigravity account was not found.')
    }
    if (this.activeAccountId === id) {
      throw new Error('Select another Antigravity account before removing the active account.')
    }
    this.store.write(accounts.filter((account) => account.id !== id))
    return this.listAccounts()
  }

  private async knownActiveAccount(accounts: StoredAccount[]): Promise<StoredAccount | null> {
    const current = await this.credentialBackend.read()
    if (!current) {
      return null
    }
    return accounts.find((account) => account.id === accountId(current.contents)) ?? null
  }
}

export function createMemoryAntigravityAccountStore(
  initial: StoredAccount[] = []
): AntigravityAccountStore {
  let accounts = [...initial]
  return {
    read: () => accounts.map((account) => ({ ...account })),
    write: (next) => {
      accounts = next.map((account) => ({ ...account }))
    }
  }
}

export function createSyntheticAntigravityAccount(
  contents: string,
  timestamp = Date.now()
): StoredAccount {
  const credential = parseAntigravityNativeCredential(contents)
  return {
    id: accountId(contents),
    email: credential.identity?.email ?? null,
    subject: credential.identity?.subject ?? null,
    authMethod: credential.authMethod,
    createdAt: timestamp,
    updatedAt: timestamp,
    credentials: contents
  }
}
