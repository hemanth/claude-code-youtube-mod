import { expect, mock, test } from 'claude-code/testing'
import { buildInlineScript, classifyTerminal, extractYouTubeId, normalizePosition } from '../hooks/register.js'

const PANE_SITE = {
  plugin: 'youtube-side-player',
  component: 'Pane',
  requestId: 'youtube-side-player',
  viewport: { columns: 110, rows: 36 },
  props: {
    title: 'YouTube Side Player',
    isFocused: true,
    bodyColumns: 58,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 24 },
    view: {},
  },
} as const

const ABOVE_PROMPT_SITE = {
  plugin: 'youtube-side-player',
  component: 'AbovePrompt',
  surface: 'terminal',
  viewport: { columns: 110, rows: 36 },
  props: {},
} as const

function registerCommonStubs(
  on: any,
  processCalls: string[][] = [],
  toasts: string[] = [],
  env: Record<string, string> = { TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' },
  processRun?: (e: any) => { exitCode: number; stdout: string; stderr: string },
) {
  mock.store(on)
  mock.env(on, env)
  mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', () => ({ value: '' }))
  on('http.fetch', () => ({
    value: {
      status: 200,
      ok: true,
      headers: {},
      text: JSON.stringify({
        title: 'Intro to Large Language Models',
        author_name: 'Andrej Karpathy',
      }),
    },
  }))
  on('process.run', (_$: any, e: any) => {
    processCalls.push(e.argv)
    if (processRun) return { value: processRun(e) }
    if (e.argv[0] === '/usr/bin/env' && e.argv[1] === 'which') {
      return { value: { exitCode: 0, stdout: '/opt/homebrew/bin/' + e.argv[2] + '\n', stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: 'ok', stderr: '' } }
  })
  on('process.spawn', async function* (_$: any, e: any) {
    processCalls.push(e.argv)
    return { code: 0, signal: null }
  })
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '- Key takeaway 1\n- Key takeaway 2\n- Key takeaway 3',
      usage: {
        input_tokens: 20,
        output_tokens: 25,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }))
  on('ui.render', () => ({
    type: 'Text',
    props: {},
    children: ['drawn by Claude Code'],
  }))
}

test('extractYouTubeId and normalizePosition parse URLs, IDs, and compass aliases', () => {
  expect(extractYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  expect(extractYouTubeId('https://www.youtube.com/watch?v=zjkBMFhNj_g&t=120s')).toBe('zjkBMFhNj_g')
  expect(extractYouTubeId('https://youtu.be/aircAruvnKk')).toBe('aircAruvnKk')
  expect(extractYouTubeId('https://www.youtube.com/shorts/r6sGWTCMz2k')).toBe('r6sGWTCMz2k')

  expect(normalizePosition('bl')).toBe('bottom-left')
  expect(normalizePosition('dock-right')).toBe('right-side')
  expect(normalizePosition('top-left')).toBe('top-left')
  expect(normalizePosition('980,60,480,270')).toBe('custom')
})

test('/yt plays video at requested screen position and renders in terminal and desktop Pane', async ($, on) => {
  const processCalls: string[][] = []
  const toasts: string[] = []
  registerCommonStubs(on, processCalls, toasts)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'yt', args: 'zjkBMFhNj_g bottom-left small' })

  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('bottom-left')
  expect(processCalls.some((argv) => argv.includes('play') && argv.includes('bottom-left'))).toBe(true)

  // Mount in both terminal (Raster radar) and desktop (Svg radar)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE_SITE, surface })
    expect(await ui.find({ type: 'Text', text: /PLAYING ON SIDE · BOTTOM-LEFT · SMALL/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Intro to Large Language Models' })).toBeDefined()
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Raster' })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('/yt pos moves player across 9-point compass, custom x,y,w,h coordinates, and AbovePrompt band', async ($, on) => {
  const processCalls: string[][] = []
  registerCommonStubs(on, processCalls)

  await $.command.run({ command: 'yt', args: 'jfKfPfyJRdk top-right' })

  // Move to left-side full-height split
  const leftRes = await $.command.run({ command: 'yt', args: 'pos left-side sidebar' })
  expect(leftRes.text).toContain('left-side [sidebar]')

  // Move to custom screen coordinates
  const customRes = await $.command.run({ command: 'yt', args: 'pos 140,220,500,280 large' })
  expect(customRes.text).toContain('custom (140,220,500,280) [large]')

  // Verify AbovePrompt mini-player band renders and cycles positions on press
  const band = await $.ui.mount(ABOVE_PROMPT_SITE)
  expect(await band.find({ type: 'Text', text: /▶ YT \[custom · large\]/ })).toBeDefined()
  await band.press({ key: 'band-cycle-pos' })
  expect(await band.find({ type: 'Text', text: /▶ YT \[top-right/ })).toBeDefined()
  await band.unmount()
})

test('Pane tabs allow interactive position snapping, notes, and AI study guide generation', async ($, on) => {
  registerCommonStubs(on)

  await $.command.run({ command: 'yt', args: 'zjkBMFhNj_g top-right' })

  const ui = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })

  // Switch to Position tab and snap to bottom-right and right-side
  await ui.press({ key: 'tab-position' })
  expect(await ui.find({ type: 'Text', text: /Choose Any Screen Position/ })).toBeDefined()

  await ui.press({ key: 'pos-bottom-right' })
  expect(await ui.find({ type: 'Text', text: /BOTTOM-RIGHT/ })).toBeDefined()

  await ui.input({ key: 'custom-coords-input', text: '820,90,460,260' })
  expect(await ui.find({ type: 'Text', text: /CUSTOM \(820,90,460,260\)/ })).toBeDefined()

  await ui.select({ key: 'size-preset-select', value: 'large' })
  expect(await ui.find({ type: 'Text', text: /LARGE/ })).toBeDefined()

  // Switch to Notes & AI tab, add a note, and generate AI summary
  await ui.press({ key: 'tab-notes' })
  await ui.input({ key: 'note-input', text: 'Check attention mechanism diagram at 14:20' })
  expect(await ui.find({ type: 'Text', text: /Check attention mechanism diagram at 14:20/ })).toBeDefined()

  await ui.press({ key: 'btn-ai-summarize' })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()

  await ui.unmount()
})

test('mcp__youtube-side-player__youtube_player tool controls playback and positioning', async ($, on) => {
  registerCommonStubs(on)

  const playRes = await $.tool.call({
    tool: 'mcp__youtube-side-player__youtube_player',
    action: 'play',
    queryOrUrl: 'aircAruvnKk',
    position: 'bottom-left',
    size: 'medium',
  })
  expect(playRes.result).toContain('bottom-left [medium]')

  const moveRes = await $.tool.call({
    tool: 'mcp__youtube-side-player__youtube_player',
    action: 'position',
    position: 'right-side',
    size: 'sidebar',
  })
  expect(moveRes.result).toContain('Moved YouTube Side Player to right-side [sidebar]')

  const pauseRes = await $.tool.call({
    tool: 'mcp__youtube-side-player__youtube_player',
    action: 'pause',
  })
  expect(pauseRes.result).toContain('Paused YouTube Side Player')

  const stopRes = await $.tool.call({
    tool: 'mcp__youtube-side-player__youtube_player',
    action: 'stop',
  })
  expect(stopRes.result).toContain('Stopped and closed YouTube Side Player')
})

test('classifyTerminal plays inline only where the pane can draw images', () => {
  expect(classifyTerminal({ surface: 'terminal', termProgram: 'ghostty', term: 'xterm-ghostty' }).canInline).toBe(true)
  expect(classifyTerminal({ surface: 'terminal', term: 'xterm-kitty' }).canInline).toBe(true)
  expect(classifyTerminal({ surface: 'terminal', termProgram: 'Apple_Terminal', term: 'xterm-256color' }).canInline).toBe(false)
  expect(classifyTerminal({ surface: 'terminal', termProgram: 'ghostty', tmux: '/tmp/tmux-501/default' }).canInline).toBe(false)
  expect(classifyTerminal({ surface: 'desktop', termProgram: 'ghostty' }).canInline).toBe(false)
})

test('in Ghostty /yt plays inline in the pane instead of the popout window', async ($, on) => {
  const processCalls: string[][] = []
  registerCommonStubs(on, processCalls, [], { TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty' })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const status = await $.command.run({ command: 'yt', args: 'mode' })
  expect(status.text).toContain('inline in the pane')

  await $.command.run({ command: 'yt', args: 'play zjkBMFhNj_g' })
  const inline = processCalls.find((argv) => argv[0] === '/bin/bash' && argv[1] === '-c')
  expect(inline?.[2]).toContain('watch?v=zjkBMFhNj_g')
  expect(inline?.[2]).toContain('-f audiotoolbox')
  expect(processCalls.some((argv) => argv[0].endsWith('/yt-pip'))).toBe(false)

  const ui = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Inline · Ghostty/ })).toBeDefined()
  await ui.unmount()
})

test('outside Ghostty/kitty /yt uses the popout window and says why', async ($, on) => {
  const processCalls: string[][] = []
  registerCommonStubs(on, processCalls)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const status = await $.command.run({ command: 'yt', args: 'status' })
  expect(status.text).toContain('popout window')
  expect(status.text).toContain('Apple_Terminal')

  await $.command.run({ command: 'yt', args: 'zjkBMFhNj_g' })
  expect(processCalls.some((argv) => argv[0].endsWith('/yt-pip') && argv.includes('play'))).toBe(true)
  expect(processCalls.some((argv) => argv[0] === '/bin/bash' && argv[1] === '-c')).toBe(false)
})

test('/yt stop clears the band above the prompt, /yt hide keeps playing', async ($, on) => {
  registerCommonStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  await $.command.run({ command: 'yt', args: 'zjkBMFhNj_g' })
  let band = await $.ui.mount(ABOVE_PROMPT_SITE)
  expect(await band.find({ type: 'Text', text: /▶ YT/ })).toBeDefined()
  await band.unmount()

  const hidden = await $.command.run({ command: 'yt', args: 'hide' })
  expect(hidden.text).toContain('still playing')
  band = await $.ui.mount(ABOVE_PROMPT_SITE)
  expect(await band.find({ type: 'Text', text: /YT \[/ })).toBeUndefined()
  await band.unmount()

  await $.command.run({ command: 'yt', args: 'show' })
  await $.command.run({ command: 'yt', args: 'stop' })
  band = await $.ui.mount(ABOVE_PROMPT_SITE)
  expect(await band.find({ type: 'Text', text: /YT \[/ })).toBeUndefined()
  await band.unmount()
})

test('buildInlineScript seeks on resume, mutes, and refuses anything but a video id', () => {
  const fresh = buildInlineScript('zjkBMFhNj_g', 0, false)
  expect(fresh).toContain('-readrate_initial_burst 1 ')
  expect(fresh).not.toContain('volume=0')
  const resumed = buildInlineScript('zjkBMFhNj_g', 42.7, true)
  expect(resumed).toContain('-ss 42 ')
  expect(resumed).toContain('-readrate_initial_burst 43 ')
  expect(resumed).toContain('-af volume=0')
  expect(() => buildInlineScript('"; rm -rf ~; "', 0, false)).toThrow()
})

test('in Ghostty without yt-dlp/ffmpeg, the first play installs them and then plays inline', async ($, on) => {
  const processCalls: string[][] = []
  const toasts: string[] = []
  let installed = false
  registerCommonStubs(on, processCalls, toasts, { TERM_PROGRAM: 'ghostty', HOME: '/Users/someone' }, (e) => {
    if (e.argv[1] === 'which') return { exitCode: 1, stdout: '', stderr: '' }
    if (e.argv[0] === '/bin/test') return { exitCode: installed ? 0 : 1, stdout: '', stderr: '' }
    if (String(e.argv[1]).endsWith('/bin/install-deps.sh')) {
      installed = true
      return { exitCode: 0, stdout: 'step downloading yt-dlp\nok ' + e.init.env.YT_MOD_DEPS_DIR + '\n', stderr: '' }
    }
    return { exitCode: 0, stdout: 'ok', stderr: '' }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const before = await $.command.run({ command: 'yt', args: 'status' })
  expect(before.text).toContain('popout window')
  expect(before.text).toContain('needs yt-dlp + ffmpeg')

  await $.command.run({ command: 'yt', args: 'zjkBMFhNj_g' })
  expect(installed).toBe(true)
  const inline = processCalls.find((argv) => argv[0] === '/bin/bash' && argv[1] === '-c')
  expect(inline?.[2]).toContain("'/Users/someone/.claude/plugins/data/youtube-side-player/bin/yt-dlp'")
  expect(inline?.[2]).toContain("exec '/Users/someone/.claude/plugins/data/youtube-side-player/bin/ffmpeg'")
  expect(toasts.some((t) => t.startsWith('Inline video ready'))).toBe(true)
  expect(processCalls.some((argv) => argv[0].endsWith('/yt-pip'))).toBe(false)
})
