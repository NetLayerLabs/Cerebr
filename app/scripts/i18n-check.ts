// i18n check: `npm run i18n:check`
//
// 1. Dictionaries: every namespace's zh has exactly the en keys, no key is defined by two
//    namespaces, and each zh string uses the same {placeholders} and <tags> as its en source.
// 2. Circuit data: every SDK catalog circuit has a Simplified Chinese name / description / story.
// 3. Source scan: parses every .tsx under src/ (rolldown's TSX parser, shipped with Vite) and
//    reports user-visible English that does not go through t() / rich(): JSX text, string props
//    (title, aria-label, placeholder, alt, label) and string literals rendered inside JSX or passed
//    as toast { title, body }. Strings made only of identifiers (NAND, eval(), OKB, addresses,
//    product names...) are allowed and listed separately, so nothing is skipped silently.
//
// Exit code 1 when anything needs translating.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAst } from 'rolldown/parseAst'
import { CATALOG } from '@cerebr/sdk'
import { NAMESPACES } from '../src/i18n/dict.ts'
import { CATALOG_ZH } from '../src/i18n/ns/circuits.zh.ts'

const root = new URL('..', import.meta.url).pathname
const problems: string[] = []
const allowed = new Map<string, string[]>()

// ---------------------------------------------------------------- 1. dictionaries
const owner = new Map<string, string>()
const shape = (s: string) => [...s.matchAll(/\{\w+\}|<\/?\w+\/?>/g)].map((m) => m[0]).sort().join(' ')
for (const [ns, { en, zh }] of Object.entries(NAMESPACES) as [string, { en: Record<string, string>; zh: Record<string, string> }][]) {
  for (const k of Object.keys(en)) {
    if (owner.has(k)) problems.push(`dict: key '${k}' is defined by both '${owner.get(k)}' and '${ns}'`)
    owner.set(k, ns)
    if (!(k in zh)) problems.push(`dict: ${ns}: zh is missing '${k}'`)
    else if (shape(en[k]) !== shape(zh[k])) problems.push(`dict: ${ns}: '${k}' placeholders/tags differ: en [${shape(en[k])}] zh [${shape(zh[k])}]`)
  }
  for (const k of Object.keys(zh)) if (!(k in en)) problems.push(`dict: ${ns}: zh has extra key '${k}'`)
}

// ---------------------------------------------------------------- 2. circuit data
for (const c of CATALOG) if (!CATALOG_ZH[c.id]) problems.push(`circuits: SDK catalog '${c.id}' (${c.name}) has no entry in src/i18n/ns/circuits.zh.ts`)

// ---------------------------------------------------------------- 3. source scan
/** Tokens that are names / identifiers / units, identical in every language. */
const KEEP = new Set(
  'NAND LATCH REF OKB XOR AND OR NOT OKX Cerebr CerebrScope TapeOut X Layer GitHub OKLink Sourcify SDK CPU NFT ERC dApp DeAI gas gwei ms eval step tapeout mint open SVG Scope CLK SPIKE COUNT FIRE y t EN CRB CRBR NetLayer Labs circuits'.split(' '),
)
/** Does a visible string contain a natural-language word (not an identifier, number or name)? */
function wordy(s: string): boolean {
  // code-like tokens are identifiers: owner(), opener.accountOf, xor.ts, @cerebr/sdk, /brand/x.png
  const plain = s.replace(/[\w.]+\(|[\w-]+(\.[\w-]+)+|[@/][\w/.@-]+/g, ' ')
  const words = plain.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []
  return words.some((w) => {
    if (KEEP.has(w)) return false
    if (w.length < 2) return false
    if (/^[A-Z0-9_-]+$/.test(w)) return false // ALLCAPS ids: CRB-N2A, I/O, …
    if (/[a-z][A-Z]/.test(w)) return false // camelCase identifiers: circuitInfo, nIn, …
    if (/^0x/i.test(w)) return false
    return true
  })
}
const TEXT_PROPS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label'])
const TOAST_PROPS = new Set(['title', 'body'])

type Node = { type: string; start: number; end: number; [k: string]: unknown }
const isNode = (x: unknown): x is Node => !!x && typeof x === 'object' && typeof (x as Node).type === 'string'

function scan(file: string) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(root, file)
  const lineOf = (pos: number) => src.slice(0, pos).split('\n').length
  const report = (pos: number, what: string, text: string) => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (!t || !/[A-Za-z]/.test(t)) return
    const where = `${rel}:${lineOf(pos)} ${what}: ${JSON.stringify(t)}`
    if (wordy(t)) problems.push(where)
    else allowed.set(t, [...(allowed.get(t) ?? []), `${rel}:${lineOf(pos)}`])
  }
  /** String literals that end up rendered: direct, or in ?: / && / || branches. */
  const rendered = (e: unknown, what: string) => {
    if (!isNode(e)) return
    if (e.type === 'Literal' && typeof e.value === 'string') report(e.start, what, e.value)
    else if (e.type === 'TemplateLiteral') for (const q of e.quasis as Node[]) report(q.start, what, String((q.value as { cooked: string }).cooked))
    else if (e.type === 'ConditionalExpression') (rendered(e.consequent, what), rendered(e.alternate, what))
    else if (e.type === 'LogicalExpression') rendered(e.right, what)
  }
  const walk = (n: unknown, inJsx: boolean) => {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, inJsx))
    if (!isNode(n)) return
    switch (n.type) {
      case 'JSXText':
        report(n.start, 'JSX text', String(n.value))
        break
      case 'JSXAttribute': {
        const name = (n.name as Node).name as string
        const v = n.value as Node | null
        if (TEXT_PROPS.has(name) && v) {
          if (v.type === 'Literal') report(v.start, `prop ${name}`, String(v.value))
          else if (v.type === 'JSXExpressionContainer') rendered(v.expression, `prop ${name}`)
        }
        break
      }
      case 'JSXExpressionContainer':
        if (inJsx) rendered(n.expression, 'JSX expression')
        break
      case 'CallExpression': {
        const callee = n.callee as Node
        const fn = callee.type === 'Identifier' ? (callee.name as string) : callee.type === 'MemberExpression' ? ((callee.property as Node).name as string) : ''
        if (fn === 'push' || fn === 'update' || fn === 'send') {
          for (const a of n.arguments as Node[]) {
            if (a.type === 'ObjectExpression')
              for (const p of a.properties as Node[]) {
                const k = p.key as Node | undefined
                if (k && TOAST_PROPS.has((k.name ?? k.value) as string)) rendered(p.value, `toast ${(k.name ?? k.value) as string}`)
              }
            else if (fn === 'send') rendered(a, 'tx label')
          }
        }
        break
      }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'start' || k === 'end' || k === 'type') continue
      // only expressions that are children of an element render as text (not className={…} etc.)
      walk(v, (n.type === 'JSXElement' || n.type === 'JSXFragment') && k === 'children')
    }
  }
  walk(parseAst(src, { lang: 'tsx' }, file), false)
}

const files: string[] = []
const collect = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) collect(p)
    else if (f.endsWith('.tsx') && !p.includes('/i18n/')) files.push(p)
  }
}
collect(join(root, 'src'))
files.forEach(scan)

// ---------------------------------------------------------------- report
console.log(`i18n check: ${Object.keys(NAMESPACES).length} namespace(s), ${owner.size} keys, ${CATALOG.length} catalog circuits, ${files.length} TSX files`)
console.log(`\nLeft untranslated on purpose (identifiers, names, units, addresses): ${allowed.size} distinct strings`)
for (const [t, at] of [...allowed].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${JSON.stringify(t)}  (${at.length}×, e.g. ${at[0]})`)
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log(`  ✕ ${p}`)
  process.exit(1)
}
console.log('\n✓ no untranslated UI strings found')
