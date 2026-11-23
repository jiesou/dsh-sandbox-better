import { describe, expect, it } from 'vitest'
import { stripAdditionalRoots } from '../src/policy-text'

describe('stripAdditionalRoots', () => {
  it('删掉目录清单，保留模式、workspace 与结尾句', () => {
    const text = 'Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: "/w".'
      + ' Additional writable directories: ["/a","/b"]. On Windows, these additional grants apply to file tools only, not sandboxed processes.'
      + ' Some platform temporary areas may also be writable.'
    const stripped = stripAdditionalRoots(text)
    expect(stripped).not.toContain('Additional writable directories')
    expect(stripped).not.toContain('/a')
    expect(stripped).toContain('session workspace: "/w"')
    expect(stripped).toContain('Some platform temporary areas may also be writable.')
  })

  it('没有清单时原样返回', () => {
    const text = 'Current DSH file policy: read-only. Nothing may be modified.'
    expect(stripAdditionalRoots(text)).toBe(text)
  })
})
