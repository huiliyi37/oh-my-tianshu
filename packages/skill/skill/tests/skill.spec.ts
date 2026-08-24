import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createScope } from '@huiliyi37/dsh-scope'
import SkillService, {
  isModelInvocable,
  isUserInvocable,
  renderSkillContent,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillProviderObservation,
} from '@huiliyi37/dsh-skill'

function memorySkill(name: string, description: string, rank: number, body = `${name} body.`): SkillCandidate {
  return {
    name,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'memory',
    source: 'memory',
    rank,
    locator: { content: body },
  }
}

class MemoryProvider implements SkillProvider {
  readonly name = 'memory'
  listCalls = 0

  constructor(private candidates: SkillCandidate[]) {}

  async list(_options: SkillLookupOptions): Promise<SkillCandidate[]> {
    this.listCalls += 1
    return this.candidates
  }

  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as { content: string }
    return { ...candidate, content: locator.content }
  }

  replace(candidates: SkillCandidate[]): void {
    this.candidates = candidates
  }
}

function registerProvider(ctx: Context, provider: SkillProvider): () => void {
  return ctx.skills.registerProvider(() => provider)
}

describe('SkillService registry', () => {
  it('registers providers, resolves duplicates first-wins, and disposes providers', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const provider = new MemoryProvider([
      memorySkill('z-skill', 'Z skill', 20),
      memorySkill('a-skill', 'A skill', 10),
      memorySkill('shadowed', 'Lower priority', 20),
    ])
    const overrideProvider: SkillProvider = {
      name: 'override',
      async list() {
        return [{
          name: 'shadowed',
          description: 'Higher priority',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'override',
          source: 'override',
          rank: 5,
          locator: { content: 'Override body.' },
        }]
      },
      async get(candidate) {
        return { ...candidate, content: (candidate.locator as { content: string }).content }
      },
    }
    const disposeMemory = registerProvider(ctx, provider)
    registerProvider(ctx, overrideProvider)

    expect((await ctx.skills.list()).map(skill => [skill.name, skill.description, skill.provider])).toEqual([
      ['a-skill', 'A skill', 'memory'],
      ['shadowed', 'Higher priority', 'override'],
      ['z-skill', 'Z skill', 'memory'],
    ])
    expect((await ctx.skills.get('shadowed'))?.content).toBe('Override body.')
    const sameRankProvider: SkillProvider = {
      name: 'same-rank',
      async list() {
        return [{
          name: 'same-rank-skill',
          description: 'Same rank',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'same-rank',
          source: 'same-rank',
          rank: 10,
          locator: { content: 'Same rank body.' },
        }]
      },
      async get(candidate) {
        return { ...candidate, content: (candidate.locator as { content: string }).content }
      },
    }
    registerProvider(ctx, sameRankProvider)
    expect((await ctx.skills.list()).find(skill => skill.name === 'same-rank-skill')?.provider).toBe('same-rank')
    await expect(ctx.plugin({
      name: 'duplicate-memory',
      inject: ['skills'],
      apply(pluginCtx: Context) {
        registerProvider(pluginCtx, new MemoryProvider([]))
      },
    })).rejects.toThrow('already registered')
    let rejectedSignal: AbortSignal | undefined
    expect(() => ctx.skills.registerProvider((control) => {
      rejectedSignal = control.signal
      return {
        name: 'runtime',
        async list() {
          return []
        },
        async get() {
          return undefined
        },
      }
    })).toThrow('reserved')
    expect(rejectedSignal?.aborted).toBe(true)

    const factoryFailure = new Error('factory failed')
    let failedSignal: AbortSignal | undefined
    expect(() => ctx.skills.registerProvider((control) => {
      failedSignal = control.signal
      throw factoryFailure
    })).toThrow(factoryFailure)
    expect(failedSignal?.reason).toBe(factoryFailure)

    const effectContext = new Context()
    const effectService = new SkillService(effectContext)
    const effectFailure = new Error('effect registration failed')
    vi.spyOn(effectContext, 'effect').mockImplementation(() => { throw effectFailure })
    let effectSignal: AbortSignal | undefined
    expect(() => effectService.registerProvider((control) => {
      effectSignal = control.signal
      return {
        name: 'effect-provider',
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
      }
    })).toThrow(effectFailure)
    expect(effectSignal?.reason).toBe(effectFailure)

    disposeMemory()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['same-rank-skill', 'shadowed'])
  })

  it('returns an invocation-neutral catalog and resolves model and user policy independently', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const registrations = [
      { name: 'both', invocation: undefined },
      { name: 'model-only', invocation: { modelInvocable: true, userInvocable: false } },
      { name: 'user-only', invocation: { modelInvocable: false, userInvocable: true } },
      { name: 'trusted-only', invocation: { modelInvocable: false, userInvocable: false } },
    ] as const
    for (const registration of registrations) {
      ctx.skills.register({
        name: registration.name,
        description: registration.name,
        source: 'runtime',
        ...registration.invocation !== undefined ? { invocation: registration.invocation } : {},
        content: `${registration.name} body.`,
      })
    }

    const listed = await ctx.skills.list()
    expect(listed.map(skill => skill.name)).toEqual(['both', 'model-only', 'trusted-only', 'user-only'])
    expect(listed.find(skill => skill.name === 'both')?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(listed.filter(isModelInvocable).map(skill => skill.name)).toEqual(['both', 'model-only'])
    expect(listed.filter(isUserInvocable).map(skill => skill.name)).toEqual(['both', 'user-only'])
    expect(await ctx.skills.get('trusted-only')).toMatchObject({ content: 'trusted-only body.' })
    expect((await ctx.skills.get('both'))?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('validates parsed candidate fields', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const badDescription = { value: 'object-description' }
    registerProvider(ctx, {
      name: 'bad-candidate',
      list: () => Promise.resolve([{
        ...memorySkill('bad-candidate', 'placeholder', 1),
        provider: 'bad-candidate',
        description: badDescription as unknown as string,
        invocation: { modelInvocable: false, userInvocable: true },
      }]),
      get: () => Promise.resolve(undefined),
    })
    await expect(ctx.skills.list()).rejects.toThrow('non-string description')

    const badBoolean = new Context()
    await badBoolean.plugin(SkillService)
    registerProvider(badBoolean, {
      name: 'bad-boolean',
      list: () => Promise.resolve([{
        ...memorySkill('bad-boolean', 'Bad boolean', 1),
        provider: 'bad-boolean',
        invocation: { modelInvocable: 'false' as unknown as boolean, userInvocable: true },
      }]),
      get: () => Promise.resolve(undefined),
    })
    await expect(badBoolean.skills.list()).rejects.toThrow('non-boolean invocation.modelInvocable')
  })

  it('rejects malformed provider results and every malformed candidate scalar', async () => {
    const malformedOutputs: unknown[] = [null, 1, {}, { candidates: [], complete: 'yes' }]
    for (const [index, output] of malformedOutputs.entries()) {
      const badList = new Context()
      await badList.plugin(SkillService)
      registerProvider(badList, {
        name: `malformed-list-${index}`,
        list: () => Promise.resolve(output as readonly SkillCandidate[] | SkillProviderObservation),
        get: () => { return Promise.resolve(undefined) },
      })
      await expect(badList.skills.list()).rejects.toThrow('list() must return an array or { candidates, complete } observation')
    }

    const cases: { patch: Partial<SkillCandidate>; expected: string }[] = [
      { patch: { name: { value: 'candidate' } as unknown as string }, expected: 'non-string skill name' },
      { patch: { whenToUse: 1 as unknown as string }, expected: 'non-string whenToUse' },
      { patch: { source: { value: 'source' } as unknown as string }, expected: 'non-string source' },
      { patch: { rank: '1' as unknown as number }, expected: 'invalid rank' },
      { patch: { provider: { value: 'provider' } as unknown as string }, expected: 'non-string provider' },
      { patch: { path: 1 as unknown as string }, expected: 'non-string path' },
    ]
    for (const [index, { patch, expected }] of cases.entries()) {
      const ctx = new Context()
      await ctx.plugin(SkillService)
      const providerName = `candidate-provider-${index}`
      const candidate = {
        name: `candidate-${index}`,
        description: 'Candidate',
        whenToUse: 'Use this candidate.',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: providerName,
        source: 'test',
        rank: 1,
        locator: 'candidate',
        path: '/skills/candidate/SKILL.md',
        ...patch,
      } as SkillCandidate
      registerProvider(ctx, {
        name: providerName,
        list: () => Promise.resolve([candidate]),
        get: () => Promise.resolve(undefined),
      })

      await expect(ctx.skills.list()).rejects.toThrow(expected)
    }
  })

  it('borrows the exact lookup options through discovery and loading', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const options: SkillLookupOptions = { cwd: '/workspace/a' }
    let listedWith: SkillLookupOptions | undefined
    let loadedWith: SkillLookupOptions | undefined
    const candidate: SkillCandidate = {
      name: 'skill-a',
      description: 'Skill A',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'contextual',
      source: 'test',
      rank: 1,
      locator: 'skill-a',
    }
    registerProvider(ctx, {
      name: 'contextual',
      async list(received) {
        listedWith = received
        return [candidate]
      },
      async get(received, lookup) {
        expect(received).toBe(candidate)
        loadedWith = lookup
        return { ...received, content: 'Skill A body.' }
      },
    })

    expect((await ctx.skills.list(options)).map(skill => skill.name)).toEqual(['skill-a'])
    expect(await ctx.skills.get('skill-a', options)).toMatchObject({ content: 'Skill A body.' })
    expect(listedWith).toBe(options)
    expect(loadedWith).toBe(options)
  })

  it('rechecks cancellation after cached discovery before provider loading', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let getCalls = 0
    registerProvider(ctx, {
      name: 'cached',
      async list() {
        return [{
          name: 'cached-skill',
          description: 'Cached skill',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'cached',
          source: 'test',
          rank: 1,
          locator: 'cached',
        }]
      },
      async get(candidate) {
        getCalls += 1
        return { ...candidate, content: 'Cached body.' }
      },
    })
    await ctx.skills.list({ cwd: '/workspace/cache' })
    const controller = new AbortController()
    const reason = new Error('cancelled after cached discovery')

    const pending = ctx.skills.get('cached-skill', {
      cwd: '/workspace/cache',
      signal: controller.signal,
    })
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(getCalls).toBe(0)
  })

  it('stops waiting for cached provider loading when a hostile abort reason fires', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let markStarted: (() => void) | undefined
    let release: (() => void) | undefined
    let seenSignal: AbortSignal | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const held = new Promise<SkillDefinition>((resolve) => {
      release = () => {
        resolve({
          name: 'held-skill',
          description: 'Held skill',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'held',
          source: 'test',
          content: 'Held body.',
        })
      }
    })
    registerProvider(ctx, {
      name: 'held',
      async list() {
        return [{
          name: 'held-skill',
          description: 'Held skill',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'held',
          source: 'test',
          rank: 1,
          locator: 'held',
        }]
      },
      get(_candidate, options) {
        seenSignal = options.signal
        markStarted?.()
        return held
      },
    })
    await ctx.skills.list({ cwd: '/workspace/cache' })
    const controller = new AbortController()
    const hostileReason = {
      [Symbol.toPrimitive]() {
        throw new Error('abort reason coercion failed')
      },
    }
    const pending = ctx.skills.get('held-skill', {
      cwd: '/workspace/cache',
      signal: controller.signal,
    })
    const outcome = pending.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error && error.message === '[unrenderable thrown value]'
        ? 'aborted'
        : 'other-error',
    )
    await started
    controller.abort(hostileReason)

    const settled = await Promise.race([
      outcome,
      new Promise<'timeout'>(resolve => setTimeout(() => { resolve('timeout') }, 25)),
    ])
    release?.()
    await pending.catch(() => undefined)

    expect(seenSignal).toBe(controller.signal)
    expect(settled).toBe('aborted')
  })

  it('borrows cached candidates and loaded definitions from the provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const locator = { id: 'provider-owned' }
    const invocation = { modelInvocable: true, userInvocable: true }
    const candidate: SkillCandidate = {
      name: 'stable-skill',
      description: 'Stable description',
      whenToUse: 'When stability matters.',
      invocation,
      provider: 'detached',
      source: 'test',
      resourceBase: { kind: 'opaque', description: 'candidate resources' },
      rank: 1,
      locator,
      path: '/skills/stable/SKILL.md',
      metadata: { owner: 'candidate' },
    }
    const definition: SkillDefinition = {
      name: 'stable-skill',
      description: 'Stable description',
      whenToUse: 'When stability matters.',
      invocation,
      provider: 'detached',
      source: 'test',
      resourceBase: { kind: 'opaque', description: 'definition resources' },
      path: '/skills/stable/SKILL.md',
      metadata: { owner: 'definition' },
      content: 'Stable body.',
    }
    let listCalls = 0
    let received: SkillCandidate | undefined
    registerProvider(ctx, {
      name: 'detached',
      async list() {
        listCalls += 1
        return [candidate]
      },
      async get(loaded) {
        received = loaded
        return definition
      },
    })

    const listed = await ctx.skills.list()
    expect(listed).toEqual([expect.objectContaining({
      name: 'stable-skill',
      description: 'Stable description',
      resourceBase: { kind: 'opaque', description: 'candidate resources' },
    })])
    expect(listed[0]?.resourceBase).toBe(candidate.resourceBase)
    expect(listed[0]?.invocation).toBe(invocation)
    expect(listCalls).toBe(1)

    const loaded = await ctx.skills.get('stable-skill')
    expect(received).toBe(candidate)
    expect(received?.locator).toBe(locator)
    expect(loaded).toBe(definition)
  })

  it('preserves readonly runtime resource identities while adding the default provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const resourceBase = { kind: 'opaque' as const, description: 'runtime resources' }
    const metadata = { owner: 'runtime' }
    const invocation = { modelInvocable: true, userInvocable: true }
    const registration = {
      name: 'runtime-skill',
      description: 'Runtime',
      whenToUse: 'When runtime data is needed.',
      invocation,
      source: 'runtime',
      resourceBase,
      metadata,
      content: 'Runtime body.',
    }
    ctx.skills.register(registration)
    ctx.skills.register({
      name: 'z-runtime',
      description: 'Second runtime skill',
      source: 'runtime',
      content: 'Second runtime body.',
    })
    const listed = await ctx.skills.list()
    const loaded = await ctx.skills.get('runtime-skill')
    expect(listed[0]?.resourceBase).toBe(resourceBase)
    expect(listed[0]?.invocation).toBe(invocation)
    expect(loaded?.resourceBase).toBe(resourceBase)
    expect(loaded?.metadata).toBe(metadata)
    expect(loaded?.provider).toBe('runtime')
  })

  it('rejects every malformed scalar in provider-loaded definitions', async () => {
    const cases: { patch: Partial<SkillDefinition>; expected: string }[] = [
      { patch: { name: { value: 'loaded' } as unknown as string }, expected: 'loaded skill name must be a string' },
      { patch: { name: 'Bad_Name' }, expected: 'loaded skill has invalid name' },
      { patch: { description: { value: 'description' } as unknown as string }, expected: 'description must be a string' },
      { patch: { description: '' }, expected: 'requires a description' },
      { patch: { invocation: null as never }, expected: 'non-object invocation policy' },
      {
        patch: { invocation: { modelInvocable: 'false' as unknown as boolean, userInvocable: true } },
        expected: 'invocation.modelInvocable',
      },
      {
        patch: { invocation: { modelInvocable: true, userInvocable: 'true' as unknown as boolean } },
        expected: 'invocation.userInvocable',
      },
      {
        patch: { invocation: { userInvocable: true } as unknown as SkillInvocationPolicy },
        expected: 'invocation.modelInvocable',
      },
      {
        patch: { invocation: { modelInvocable: true } as unknown as SkillInvocationPolicy },
        expected: 'invocation.userInvocable',
      },
      { patch: { whenToUse: 1 as unknown as string }, expected: 'whenToUse must be a string' },
      { patch: { source: { value: 'source' } as unknown as string }, expected: 'source must be a string' },
      { patch: { provider: { value: 'provider' } as unknown as string }, expected: 'provider must be a string' },
      { patch: { content: { value: 'content' } as unknown as string }, expected: 'content must be a string' },
      { patch: { path: 1 as unknown as string }, expected: 'path must be a string' },
    ]
    for (const [index, { patch, expected }] of cases.entries()) {
      const ctx = new Context()
      await ctx.plugin(SkillService)
      const providerName = `definition-provider-${index}`
      const skillName = `definition-${index}`
      registerProvider(ctx, {
        name: providerName,
        list: () => Promise.resolve([{
          name: skillName,
          description: 'Candidate',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: providerName,
          source: 'test',
          rank: 1,
          locator: 'definition',
        }]),
        get: () => Promise.resolve({
          name: skillName,
          description: 'Definition',
          whenToUse: 'Use this definition.',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: providerName,
          source: 'test',
          content: 'Definition body.',
          path: '/skills/definition/SKILL.md',
          ...patch,
        } as SkillDefinition),
      })

      await expect(ctx.skills.get(skillName)).rejects.toThrow(expected)
    }
  })

  it('validates provider candidates and invalid registry caps', async () => {
    const defaultedService = new SkillService(new Context())
    expect(await defaultedService.list()).toEqual([])

    const ctx = new Context()
    await ctx.plugin(SkillService)
    registerProvider(ctx, {
      name: 'bad',
      async list() {
        return [memorySkill('Bad_Name', 'bad', 1)]
      },
      async get() {
        return undefined
      },
    })
    await expect(ctx.skills.list()).rejects.toThrow('invalid skill name')

    const invalidCandidates = [
      { ...memorySkill('empty-description', '', 1), provider: 'empty-description' },
      { ...memorySkill('bad-rank', 'Bad rank', Number.NaN), provider: 'bad-rank' },
      { ...memorySkill('wrong-provider', 'Wrong provider', 1), provider: 'different' },
    ]
    for (const candidate of invalidCandidates) {
      const invalid = new Context()
      await invalid.plugin(SkillService)
      registerProvider(invalid, {
        name: candidate.name,
        async list() {
          return [candidate]
        },
        async get() {
          return undefined
        },
      })
      await expect(invalid.skills.list()).rejects.toThrow('skill provider')
    }

    await expect(new Context().plugin(SkillService, { collectCacheMaxEntries: 1.5 })).rejects.toThrow('collectCacheMaxEntries')
  })

  it('sorts model-visible summaries without locale-sensitive collation', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    registerProvider(ctx, new MemoryProvider([
      memorySkill('z-skill', 'Z skill', 10),
      memorySkill('a-skill', 'A skill', 10),
    ]))
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare')
    const sort = vi.spyOn(Array.prototype, 'sort')

    try {
      const skills = await ctx.skills.list()
      expect(skills.map(skill => skill.name)).toEqual(['a-skill', 'z-skill'])
      expect(localeCompare).not.toHaveBeenCalled()

      const summaryComparator = sort.mock.calls.at(-1)?.[0]
      expect(summaryComparator).toBeTypeOf('function')
      expect(summaryComparator?.(skills[0], skills[0])).toBe(0)
    } finally {
      sort.mockRestore()
      localeCompare.mockRestore()
    }
  })

  it('caches provider discovery, skips failing providers, and invalidates on runtime skills', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService, { collectCacheMaxEntries: 1 })
    const provider = new MemoryProvider([memorySkill('first-skill', 'First', 10)])
    registerProvider(ctx, provider)

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['first-skill'])
    provider.replace([memorySkill('second-skill', 'Second', 10)])
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['first-skill'])

    const disposeRuntime = ctx.skills.register({
      name: 'runtime-skill',
      description: 'Runtime',
      source: 'runtime',
      resourceBase: { kind: 'opaque', description: 'runtime memory' },
      path: 'memory://runtime-skill',
      metadata: { owner: 'tests' },
      content: 'Runtime body.',
    })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['runtime-skill', 'second-skill'])
    expect(await ctx.skills.get('runtime-skill')).toMatchObject({
      content: 'Runtime body.',
      path: 'memory://runtime-skill',
      metadata: { owner: 'tests' },
    })
    disposeRuntime()
    await ctx.skills.list({ cwd: '/tmp/first-cache-key' })
    await ctx.skills.list({ cwd: '/tmp/second-cache-key' })

    let fail = true
    let flakyCalls = 0
    registerProvider(ctx, {
      name: 'flaky',
      async list() {
        flakyCalls += 1
        if (fail) throw new Error('transient discovery failure')
        return [{ ...memorySkill('flaky-skill', 'Flaky', 10), provider: 'flaky' }]
      },
      async get() {
        return undefined
      },
    })
    const incomplete = await ctx.skills.snapshot()
    expect(incomplete.skills.map(skill => skill.name)).toEqual(['second-skill'])
    expect(incomplete.complete).toBe(false)
    expect(flakyCalls).toBe(1)
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['second-skill'])
    expect(flakyCalls).toBe(2)
    fail = false
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['flaky-skill', 'second-skill'])
    expect(flakyCalls).toBe(3)
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['flaky-skill', 'second-skill'])
    expect(flakyCalls).toBe(3)
  })

  it('keeps candidates from incomplete provider observations loadable without caching them', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let listCalls = 0
    registerProvider(ctx, {
      name: 'incomplete-candidates',
      async list() {
        listCalls += 1
        return {
          candidates: [{ ...memorySkill('available-skill', 'Available', 10), provider: 'incomplete-candidates' }],
          complete: false,
        }
      },
      async get(candidate) {
        return { ...candidate, content: (candidate.locator as { content: string }).content }
      },
    })

    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'available-skill' }],
      complete: false,
    })
    expect((await ctx.skills.get('available-skill'))?.content).toBe('available-skill body.')
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['available-skill'])
    expect(listCalls).toBe(3)
  })

  it('invalidates only the exact registered provider and ignores its late callbacks', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const provider = new MemoryProvider([memorySkill('first-skill', 'First', 10)])
    let invalidate = (): void => {}
    let signal: AbortSignal | undefined
    const dispose = ctx.skills.registerProvider((control) => {
      invalidate = control.invalidate
      signal = control.signal
      return provider
    })

    expect((await ctx.skills.snapshot()).complete).toBe(true)
    provider.replace([memorySkill('second-skill', 'Second', 10)])
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['first-skill'])

    invalidate()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['second-skill'])
    dispose()
    expect(signal?.aborted).toBe(true)

    const replacement = new MemoryProvider([memorySkill('replacement-skill', 'Replacement', 10)])
    registerProvider(ctx, replacement)
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['replacement-skill'])
    invalidate()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['replacement-skill'])
    expect(replacement.listCalls).toBe(1)
  })

  it('emits catalog invalidations for live provider and runtime mutations', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const provider = new MemoryProvider([memorySkill('provider-skill', 'Provider', 10)])
    let changes = 0
    ctx.on('skills/change', () => { changes += 1 })

    let invalidate = (): void => {}
    const disposeProvider = ctx.skills.registerProvider((control) => {
      invalidate = control.invalidate
      return provider
    })
    expect(changes).toBe(1)
    invalidate()
    expect(changes).toBe(2)

    const disposeRuntime = ctx.skills.register({
      name: 'runtime-skill',
      description: 'Runtime',
      source: 'runtime',
      content: 'Runtime body.',
    })
    expect(changes).toBe(3)
    disposeRuntime()
    expect(changes).toBe(4)
    disposeProvider()
    expect(changes).toBe(5)
    invalidate()
    expect(changes).toBe(5)
  })

  it('contains synchronous and asynchronous catalog observer failures', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const disposeThrowing = ctx.on('skills/change', () => { throw new Error('observer threw') })
    // oxlint-disable-next-line typescript/no-misused-promises -- deliberate rejection proves notification containment
    const disposeRejecting = ctx.on('skills/change', () => Promise.reject(new Error('observer rejected')))
    let observed = 0
    const disposeObserver = ctx.on('skills/change', () => { observed += 1 })

    const provider = new MemoryProvider([])
    expect(() => registerProvider(ctx, provider)).not.toThrow()
    await Promise.resolve()
    expect(observed).toBe(1)
    expect(warnings).toEqual([
      'skills/change listener threw: Error: observer threw',
      'skills/change listener rejected: Error: observer rejected',
    ])

    disposeThrowing()
    disposeRejecting()
    disposeObserver()
  })

  it('retries an in-flight catalog invalidated by its provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let release: (() => void) | undefined
    const started = Promise.withResolvers<undefined>()
    const gate = new Promise<void>((resolve) => { release = resolve })
    const provider = new MemoryProvider([memorySkill('stale-skill', 'Stale', 10)])
    const originalList = provider.list.bind(provider)
    provider.list = async (options) => {
      if (provider.listCalls === 0) {
        provider.listCalls += 1
        started.resolve(undefined)
        await gate
        return [memorySkill('stale-skill', 'Stale', 10)]
      }
      return await originalList(options)
    }
    let invalidate = (): void => {}
    ctx.skills.registerProvider((control) => {
      invalidate = control.invalidate
      return provider
    })

    const pending = ctx.skills.list()
    await started.promise
    provider.replace([memorySkill('fresh-skill', 'Fresh', 10)])
    invalidate()
    release?.()

    expect((await pending).map(skill => skill.name)).toEqual(['fresh-skill'])
    expect(provider.listCalls).toBe(2)
  })

  it('bounds repeated in-flight invalidation and leaves the result uncached', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let listCalls = 0
    ctx.skills.registerProvider(control => ({
      name: 'self-invalidating',
      async list() {
        listCalls += 1
        control.invalidate()
        return [{
          ...memorySkill('bounded-skill', `Attempt ${listCalls}`, 10),
          provider: 'self-invalidating',
        }]
      },
      async get() {
        return undefined
      },
    }))

    expect(await ctx.skills.snapshot()).toEqual({
      skills: [{
        name: 'bounded-skill',
        description: 'Attempt 2',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'self-invalidating',
        source: 'memory',
      }],
      complete: false,
    })
    expect(listCalls).toBe(2)

    expect((await ctx.skills.snapshot()).skills[0]?.description).toBe('Attempt 4')
    expect(listCalls).toBe(4)
  })

  it('invalidates a provider whose loaded definition changed identity', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let listCalls = 0
    const provider: SkillProvider = {
      name: 'renamed',
      async list() {
        listCalls += 1
        return [{
          name: 'old-name',
          description: 'Old name',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'renamed',
          source: 'test',
          rank: 1,
          locator: 'old-name',
        }]
      },
      async get(candidate) {
        return { ...candidate, name: 'new-name', content: 'Fresh body.' }
      },
    }
    registerProvider(ctx, provider)

    expect(await ctx.skills.get('old-name')).toBeUndefined()
    await ctx.skills.list()
    expect(listCalls).toBe(2)
  })

  it('returns undefined when a discovered candidate disappears before loading', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    registerProvider(ctx, {
      name: 'vanished-body',
      async list() {
        return [{ ...memorySkill('vanished-skill', 'Vanished', 10), provider: 'vanished-body' }]
      },
      async get() {
        return undefined
      },
    })

    await expect(ctx.skills.get('vanished-skill')).resolves.toBeUndefined()
  })

  it('contains a provider rejection whose string coercion throws', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const hostileFailure = {
      toString() {
        throw new Error('provider failure coercion failed')
      },
    }
    registerProvider(ctx, {
      name: 'hostile-failure',
      list() {
        // Deliberately violate the provider contract to prove containment is total.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        return Promise.reject(hostileFailure)
      },
      async get() {
        return undefined
      },
    })

    await expect(ctx.skills.list()).resolves.toEqual([])
    expect(warnings).toEqual([
      'skill provider "hostile-failure" skipped: [unrenderable thrown value]',
    ])
  })

  it('abandons an in-flight catalog when provider registrations change', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let markStarted: (() => void) | undefined
    let release: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const dispose = registerProvider(ctx, {
      name: 'delayed',
      async list() {
        markStarted?.()
        await gate
        return [{ ...memorySkill('stale-skill', 'Stale', 10), provider: 'delayed' }]
      },
      async get(candidate) {
        return { ...candidate, content: 'Stale body.' }
      },
    })

    const pending = ctx.skills.list()
    await started
    dispose()
    release?.()

    expect(await pending).toEqual([])
  })

  it('stops waiting for discovery when its lookup signal aborts', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    let markStarted: (() => void) | undefined
    let release: (() => void) | undefined
    let seenSignal: AbortSignal | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const held = new Promise<SkillCandidate[]>((resolve) => {
      release = () => { resolve([]) }
    })
    registerProvider(ctx, {
      name: 'uncooperative',
      list(options) {
        seenSignal = options.signal
        markStarted?.()
        return held
      },
      async get() {
        return undefined
      },
    })
    const controller = new AbortController()
    const reason = 'discovery cancelled'
    const pending = ctx.skills.list({ signal: controller.signal })
    const outcome = pending.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error && error.message === reason ? 'aborted' : 'other-error',
    )
    await started
    controller.abort(reason)

    const settled = await Promise.race([
      outcome,
      new Promise<'timeout'>(resolve => setTimeout(() => { resolve('timeout') }, 25)),
    ])
    release?.()
    await pending.catch(() => undefined)

    expect(seenSignal).toBe(controller.signal)
    expect(settled).toBe('aborted')
  })

  it('rejects invalid runtime skill registrations and ignores duplicates', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    expect(() => ctx.skills.register({ name: 'Bad_Name', description: 'Bad', source: 'runtime', content: 'bad' })).toThrow('invalid skill name')
    expect(() => ctx.skills.register({ name: 'no-description', description: '', source: 'runtime', content: 'bad' })).toThrow('requires a description')
    expect(() => ctx.skills.register({
      name: 'bad-invocation',
      description: 'Bad invocation',
      source: 'runtime',
      invocation: [] as never,
      content: 'bad',
    })).toThrow('non-object invocation policy')
    expect(await ctx.skills.get('missing-skill')).toBeUndefined()
    expect(await ctx.skills.get('Bad_Name')).toBeUndefined()

    const disposeFirst = ctx.skills.register({ name: 'same-skill', description: 'First', source: 'runtime', content: 'first' })
    const disposeSecond = ctx.skills.register({ name: 'same-skill', description: 'Second', source: 'runtime', content: 'second' })
    disposeSecond()
    expect((await ctx.skills.get('same-skill'))?.description).toBe('First')
    disposeFirst()
    expect(await ctx.skills.get('same-skill')).toBeUndefined()
  })
})

describe('renderSkillContent', () => {
  it('renders a directory-based skill with the shared wrapper', () => {
    const text = renderSkillContent({
      name: 'demo-skill',
      provider: 'memory',
      resourceBase: { kind: 'directory', path: '/tmp/demo' },
      content: 'Do the thing.',
    })
    expect(text).toBe([
      '<skill_content name="demo-skill">',
      '<skill_resources>',
      'Base directory for this skill: /tmp/demo',
      'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.',
      '</skill_resources>',
      '',
      '<skill_instructions>',
      'Do the thing.',
      '</skill_instructions>',
      '</skill_content>',
    ].join('\n'))
  })

  it('renders url and opaque resource hints', () => {
    const url = renderSkillContent({
      name: 'url-skill',
      provider: 'memory',
      resourceBase: { kind: 'url', url: 'https://example.test/base/' },
      content: 'Body.',
    })
    expect(url).toContain('Base URL for this skill: https://example.test/base/')
    expect(url).toContain('Resolve relative URLs mentioned by this skill against the base URL before using them.')

    const opaque = renderSkillContent({
      name: 'opaque-skill',
      provider: 'memory',
      resourceBase: { kind: 'opaque', description: 'archive <bundle>' },
      content: 'Body.',
    })
    expect(opaque).toContain('Resources for this skill: archive &lt;bundle&gt;')
  })

  it('falls back to the provider hint without a resource base', () => {
    const text = renderSkillContent({
      name: 'provider-skill',
      provider: 'remote <hub>',
      content: 'Body.',
    })
    expect(text).toContain('Resources for this skill are managed by provider "remote &lt;hub&gt;".')
  })

  it('escapes hostile attribute names and keeps the body verbatim', () => {
    const text = renderSkillContent({
      name: 'x"&<y',
      provider: 'memory',
      resourceBase: { kind: 'directory', path: '/tmp' },
      content: 'Keep </skill_content> and <tags> as-is.',
    })
    expect(text).toContain('<skill_content name="x&quot;&amp;&lt;y">')
    expect(text).toContain('Keep </skill_content> and <tags> as-is.')
  })
})

describe('SkillService scoped providers', () => {
  /** Mounted under a scope so its traced ctx.skills calls carry the scope key. */
  function scopedRegistrar(tag: string, providerName: string) {
    return {
      name: `reg-${tag}`,
      inject: ['skills'],
      apply(c: Context) {
        c.skills.registerProvider(() => ({
          name: providerName,
          async list() {
            return [{
              name: `sk-${tag.toLowerCase()}`,
              description: tag,
              invocation: { modelInvocable: true, userInvocable: true },
              provider: providerName,
              source: providerName,
              rank: 10,
              locator: { content: tag },
            }]
          },
          async get(candidate: SkillCandidate) {
            return { ...candidate, content: (candidate.locator as { content: string }).content }
          },
        }))
      },
    }
  }

  async function viewThrough(c: Context): Promise<string[]> {
    let names: string[] = []
    await c.plugin({
      name: `view-${Math.random().toString(36).slice(2, 8)}`,
      inject: ['skills'],
      async apply(pc: Context) {
        names = (await pc.skills.list()).map(skill => skill.name)
      },
    })
    return names
  }

  it('two live presets may each run a same-named provider; views stay per scope', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const scopeA = createScope(ctx, { preset: 'a' })
    const scopeB = createScope(ctx, { preset: 'b' })

    // 同名提供方分别进入各自 standing 作用域——修复前第二个注册即抛
    // "a skill provider named \"local\" is already registered"。
    await scopeA.ctx.plugin(scopedRegistrar('A', 'local'))
    await scopeB.ctx.plugin(scopedRegistrar('B', 'local'))

    expect(await viewThrough(scopeA.ctx)).toEqual(['sk-a'])
    expect(await viewThrough(scopeB.ctx)).toEqual(['sk-b'])
    expect(await viewThrough(ctx)).toEqual([])
    await scopeA.dispose()
    await scopeB.dispose()
  })

  it('a scoped provider shadows the global same name for its scope only', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    await ctx.plugin(scopedRegistrar('Global', 'local'))
    const scope = createScope(ctx, { preset: 'scoped' })
    await scope.ctx.plugin(scopedRegistrar('Scoped', 'local'))

    expect(await viewThrough(scope.ctx)).toEqual(['sk-scoped'])
    expect(await viewThrough(ctx)).toEqual(['sk-global'])
    await scope.dispose()
  })

  it('a same-name duplicate inside ONE scope still fails loud', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const scope = createScope(ctx, { preset: 'dup' })
    await scope.ctx.plugin(scopedRegistrar('First', 'local'))
    await expect(scope.ctx.plugin(scopedRegistrar('Second', 'local')))
      .rejects.toThrow('a skill provider named "local" is already registered')
    await scope.dispose()
  })
})
