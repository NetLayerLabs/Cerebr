export const TIERS = [
  { id: 0, name: 'Basic', color: '#3ddc97', odds: [60, 25, 12, 3], cores: '8–128', clock: '1.0–5.9', node: '14/7/5/3' },
  { id: 1, name: 'Pro', color: '#2bb3ff', odds: [35, 35, 22, 8], cores: '32–256', clock: '2.0–6.9', node: '7/5/3/2' },
  { id: 2, name: 'Quantum', color: '#b26bff', odds: [10, 35, 38, 17], cores: '128–512', clock: '3.0–7.9', node: '5/3/2/1' },
  { id: 3, name: 'Singularity', color: '#ffb000', odds: [0, 15, 45, 40], cores: '512–1024', clock: '5.0–9.9', node: '3/2/1' },
] as const

export const RARITY_COLORS: Record<string, string> = {
  Common: '#3ddc97',
  Rare: '#2bb3ff',
  Epic: '#b26bff',
  Legendary: '#ffb000',
}

export const tierName = (t: number) => TIERS[t]?.name ?? `Tier ${t}`
