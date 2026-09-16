import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { PE_MACHINE, isLoadableByArch, readPeMachine } = require('./windows-pe-machine.cjs')

const fixtureDir = mkdtempSync(join(tmpdir(), 'windows-pe-machine-'))

function writeImage(name, build) {
  const path = join(fixtureDir, name)
  writeFileSync(path, build())
  return path
}

function peImage({ machine, peOffset = 0x80, signature = 'PE\0\0', magic = 'MZ' }) {
  const image = Buffer.alloc(peOffset + 8)
  image.write(magic, 0, 'latin1')
  image.writeUInt32LE(peOffset, 0x3c)
  image.write(signature, peOffset, 'latin1')
  image.writeUInt16LE(machine, peOffset + 4)
  return image
}

const X64 = writeImage('x64.node', () => peImage({ machine: PE_MACHINE.x64 }))
const ARM64 = writeImage('arm64.node', () => peImage({ machine: PE_MACHINE.arm64 }))

describe('PE_MACHINE', () => {
  // Spelled out rather than taken from the module: the fixtures below build
  // their headers from these, so a table that is wrong in both entries would
  // otherwise agree with itself.
  it('holds the IMAGE_FILE_MACHINE values Windows actually stamps', () => {
    expect(PE_MACHINE).toEqual({ x64: 0x8664, arm64: 0xaa64 })
  })
})

describe('readPeMachine', () => {
  it.each([
    ['x64', X64, PE_MACHINE.x64],
    ['arm64', ARM64, PE_MACHINE.arm64]
  ])('reads the machine field of a %s image', (_case, path, expected) => {
    expect(readPeMachine(path)).toBe(expected)
  })

  // Callers ask this of files they did not produce, so anything that is not a
  // PE has to be an answer rather than a crash.
  it.each([
    ['a Mach-O or ELF binary', () => Buffer.alloc(0x200)],
    ['a file too short to hold a DOS header', () => Buffer.from('MZ')],
    [
      'a DOS stub whose PE offset points nowhere',
      () => peImage({ machine: 0x8664, peOffset: 0x8000 }).subarray(0, 0x88)
    ],
    ['a file with no PE signature', () => peImage({ machine: 0x8664, signature: 'XX\0\0' })]
  ])('returns null for %s', (_case, build) => {
    expect(readPeMachine(writeImage(`not-pe-${Math.random()}.bin`, build))).toBeNull()
  })

  it('respects the DOS header pointer rather than a fixed offset', () => {
    const path = writeImage('shifted.node', () =>
      peImage({ machine: PE_MACHINE.arm64, peOffset: 0x120 })
    )
    expect(readPeMachine(path)).toBe(PE_MACHINE.arm64)
  })
})

describe('isLoadableByArch', () => {
  // The whole point: node-pty's loader swallows the require failure of a
  // wrong-arch addon and falls through, so this decides which binary runs.
  it.each([
    ['x64 by x64', X64, 'x64', true],
    ['arm64 by arm64', ARM64, 'arm64', true],
    ['x64 by arm64', X64, 'arm64', false],
    ['arm64 by x64', ARM64, 'x64', false]
  ])('%s', (_case, path, arch, expected) => {
    expect(isLoadableByArch(path, arch)).toBe(expected)
  })

  it('treats a binary it cannot parse as loadable by nothing', () => {
    const path = writeImage('garbage.node', () => Buffer.alloc(0x200))
    expect(isLoadableByArch(path, 'x64')).toBe(false)
    expect(isLoadableByArch(path, 'arm64')).toBe(false)
  })
})
