import { describe, expect, it } from 'vitest'
import { clearSchemaCache, loadSchema, SchemaLoadError, URL_MAX_BYTES, URL_TIMEOUT_MS } from '../src/schemas/loader.ts'
import type { SchemaSource } from '../src/schemas/loader.ts'
import { BUILTIN_SCHEMAS, isBuiltinName } from '../src/schemas/builtin.ts'

function fakeSource(files: Record<string, string>): SchemaSource & { fetched: string[] } {
  const fetched: string[] = []
  const lookup = (path: string): string | undefined =>
    files[path] ?? files[path.replaceAll('\\', '/')]
  return {
    fetched,
    async readFileText(path: string): Promise<string> {
      const content = lookup(path)
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
    },
    async fetchUrl(url: string): Promise<string> {
      fetched.push(url)
      const content = lookup(url)
      if (content === undefined) throw new Error(`fetch failed: ${url}`)
      return content
    },
  }
}

const CUSTOM = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', description: '名字' },
    tags: { type: 'array', items: { type: 'string', description: '标签' }, maxItems: 5, description: '标签列表' },
  },
})

const options = (source: SchemaSource, schemaDir = '/schemas') => ({ source, schemaDir })

describe('内置 schema', () => {
  it('5 套内置齐全且根为 object', () => {
    expect(Object.keys(BUILTIN_SCHEMAS).sort()).toEqual(['debug', 'executive', 'postmortem', 'summary', 'tutorial'])
    for (const schema of Object.values(BUILTIN_SCHEMAS)) {
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(false)
      expect(Array.isArray(schema.required)).toBe(true)
    }
  })

  it('按名加载返回深拷贝（修改不影响后续加载）', async () => {
    const first = await loadSchema('summary', options(fakeSource({})))
    expect(first.kind).toBe('builtin')
    ;(first.schema as { properties: Record<string, unknown> }).properties = {} as never
    const second = await loadSchema('summary', options(fakeSource({})))
    expect(Object.keys((second.schema as { properties: object }).properties).length).toBeGreaterThan(0)
  })
})

describe('已保存名', () => {
  it('从 schemaDir 加载 <name>.json', async () => {
    const source = fakeSource({ '/schemas/my-report.json': CUSTOM })
    const loaded = await loadSchema('my-report', options(source))
    expect(loaded.kind).toBe('saved')
    expect(loaded.name.endsWith('my-report.json')).toBe(true)
    expect((loaded.schema as { properties: object }).properties).toBeDefined()
  })

  it('非法名字拒绝（不触发文件读取）', async () => {
    const source = fakeSource({})
    await expect(loadSchema('bad name!', options(source))).rejects.toBeInstanceOf(SchemaLoadError)
  })

  it('文件不存在时包装为 SchemaLoadError', async () => {
    const source = fakeSource({})
    await expect(loadSchema('ghost', options(source))).rejects.toMatchObject({ code: 'SCHEMA_LOAD_FAILED' })
  })
})

describe('路径加载', () => {
  it('相对/绝对路径直读文件', async () => {
    const source = fakeSource({ './local.json': CUSTOM, 'C:\\x\\schema.json': CUSTOM })
    expect((await loadSchema('./local.json', options(source))).kind).toBe('file')
    expect((await loadSchema('C:\\x\\schema.json', options(source))).kind).toBe('file')
  })

  it('JSON 解析失败报错', async () => {
    const source = fakeSource({ './bad.json': '{oops' })
    await expect(loadSchema('./bad.json', options(source))).rejects.toMatchObject({ code: 'SCHEMA_LOAD_FAILED' })
  })
})

describe('URL 加载', () => {
  it('http:// 拒绝（仅 HTTPS）', async () => {
    const source = fakeSource({})
    await expect(loadSchema('http://x.com/s.json', options(source)))
      .rejects.toThrow('HTTPS')
    expect(source.fetched).toEqual([])
  })

  it('https:// 正常加载', async () => {
    const source = fakeSource({ 'https://x.com/s.json': CUSTOM })
    const loaded = await loadSchema('https://x.com/s.json', options(source))
    expect(loaded.kind).toBe('url')
    expect(source.fetched).toEqual(['https://x.com/s.json'])
  })

  it('超过大小上限拒绝', async () => {
    const big = JSON.stringify({ type: 'object', properties: { pad: { type: 'string', description: 'x'.repeat(URL_MAX_BYTES) } } })
    const source = fakeSource({ 'https://x.com/big.json': big })
    await expect(loadSchema('https://x.com/big.json', options(source))).rejects.toThrow('上限')
  })

  it('进程级缓存：同一 URL 只取一次', async () => {
    clearSchemaCache()
    const source = fakeSource({ 'https://x.com/c.json': CUSTOM })
    await loadSchema('https://x.com/c.json', options(source))
    await loadSchema('https://x.com/c.json', options(source))
    expect(source.fetched.length).toBe(1)
    clearSchemaCache()
    await loadSchema('https://x.com/c.json', options(source))
    expect(source.fetched.length).toBe(2)
  })

  it('超时参数传递', async () => {
    const seen: { timeoutMs: number }[] = []
    const source: SchemaSource = {
      async readFileText() { return '' },
      async fetchUrl(_url, opts) { seen.push({ timeoutMs: opts.timeoutMs }); return CUSTOM },
    }
    await loadSchema('https://x.com/t.json', options(source))
    expect(seen[0]?.timeoutMs).toBe(URL_TIMEOUT_MS)
  })
})

describe('结构安全检查', () => {
  let counter = 0
  const load = (schema: unknown) => {
    // 每个用例用独立 spec，避免命中进程级缓存（缓存语义在 URL 用例单独验证）。
    clearSchemaCache()
    counter += 1
    const spec = `./s-${counter}.json`
    const raw = JSON.stringify(schema)
    return loadSchema(spec, options(fakeSource({ [spec]: raw })))
  }

  it('非对象根拒绝', async () => {
    await expect(load([])).rejects.toThrow('根必须是 JSON Schema 对象')
    await expect(load('str')).rejects.toThrow('根必须是 JSON Schema 对象')
  })

  it('根非 object 拒绝', async () => {
    await expect(load({ type: 'string' })).rejects.toThrow('根必须是 type: "object"')
  })

  it('缺 properties 拒绝', async () => {
    await expect(load({ type: 'object' })).rejects.toThrow('properties')
  })

  it('顶层属性超 30 拒绝', async () => {
    const props: Record<string, unknown> = {}
    for (let i = 0; i < 31; i += 1) props[`f${i}`] = { type: 'string', description: 'x' }
    await expect(load({ type: 'object', properties: props })).rejects.toThrow('上限')
  })

  it('$ref 一律拒绝（v1 不支持）', async () => {
    await expect(load({ type: 'object', properties: { a: { $ref: '#/x', description: 'x' } } }))
      .rejects.toThrow('$ref')
  })

  it('嵌套深度超 5 拒绝', async () => {
    let node: Record<string, unknown> = { type: 'string', description: 'x' }
    for (let i = 0; i < 6; i += 1) node = { type: 'object', properties: { child: node } }
    await expect(load({ type: 'object', properties: { a: node } })).rejects.toThrow('嵌套深度')
  })

  it('缺 type/description 记警告但放行', async () => {
    const schema = { type: 'object', properties: { name: { description: 'n' }, age: { type: 'number' } } }
    const loaded = await load(schema)
    expect(loaded.warnings.length).toBeGreaterThanOrEqual(2)
    expect(loaded.warnings.some(w => w.includes('type'))).toBe(true)
    expect(loaded.warnings.some(w => w.includes('description'))).toBe(true)
  })

  it('合法 schema 无警告', async () => {
    const loaded = await load(JSON.parse(CUSTOM))
    expect(loaded.warnings).toEqual([])
  })
})
