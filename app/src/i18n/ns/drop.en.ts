/**
 * Drop namespace (components/GenesisDropCard.tsx and the Genesis Drop call-to-action on the landing
 * page), English (the source). Owned by the Genesis Drop feature: every key starts with 'drop.'.
 * drop.zh.ts must define exactly these keys.
 */
export const en = {
  'drop.head': 'Genesis Drop #{id}',
  'drop.loading': 'Reading the drop onchain…',
  'drop.pill.live': 'Live',
  'drop.pill.claimed': 'Claimed',
  'drop.pill.ended': 'Ended',
  'drop.title': 'Claim <em>{n} {kind}</em>, tape out your first neuron.',
  'drop.titleClaimed': 'Your <em>{n} {kind}</em> are in. Tape out your first neuron.',
  'drop.lede':
    'Free {kind} transistors for early builders, paid out onchain by TapeOut’s ownerless drops contract. {n} {kind} is exactly what a 4-input neuron burns, so your first circuit costs only the tape-out fee.',

  // claim
  'drop.youPay': 'You pay to claim',
  'drop.youPayV': '0 OKB + gas',
  'drop.gas': 'Network gas (est.)',
  'drop.then': 'Then, to tape out',
  'drop.thenV': '{fee} OKB fee + gas',
  'drop.connect': 'Connect a wallet to claim',
  'drop.connectBody': 'Connect a wallet (top right) to claim.',
  'drop.claimBtn': 'Claim {n} {kind}',
  'drop.claiming': 'Claiming…',
  'drop.claimTx': 'Claim {n} {kind} (Genesis Drop #{id})',
  'drop.rule':
    'One claim per address. No fee and no allowlist: the drops contract sends {n} {kind} straight to your wallet, and you pay only network gas.',

  // after the claim
  'drop.done': 'Claimed: {n} {kind} landed in your wallet.',
  'drop.already': 'This address has claimed its {n} {kind}.',
  'drop.txLink': 'View transaction',
  'drop.next': 'Next step',
  'drop.nextCta': 'Tape out your first neuron',
  'drop.nextBody':
    'Circuit Studio opens with a 4-input threshold neuron that is not onchain yet, picked for your address. It compiles to exactly {nand} NAND, the transistors from the drop. Change the weights first if you like: any design up to {nand} NAND needs no mint.',
  'drop.design': 'Design',
  'drop.burns': 'Burns',
  'drop.burnsV': '{nand} NAND',
  'drop.tapeFee': 'Tape-out fee',
  'drop.mintMissing': 'Mint {n} NAND first',
  'drop.total': 'You pay',
  'drop.totalV': '{fee} OKB + gas',

  // side panel
  'drop.remaining': 'Remaining',
  'drop.remainingU': '{kind} in the drop',
  'drop.claimsLeft': 'Claims left',
  'drop.claimsLeftU': 'of {total}',
  'drop.claimedCount': 'Claimed',
  'drop.claimedU': '{amt} {kind} handed out',
  'drop.perClaim': 'Per claim',
  'drop.perClaimU': '{kind} per address',
  'drop.meter': '{pct}% claimed',
  'drop.wallet': 'Your wallet',
  'drop.walletNone': 'not connected',
  'drop.walletOpen': 'can claim',
  'drop.walletClaimed': 'claimed',
  'drop.holding': 'You hold',

  // decoded reverts
  'drop.err.claimed': 'This address already claimed the Genesis Drop. One claim per address.',
  'drop.err.drained': 'The drop is drained: not enough NAND left for another claim.',
  'drop.err.cancelled': 'This drop was cancelled by its creator.',
  'drop.err.noDrop': 'This drop does not exist.',
  'drop.err.receiver': 'This wallet is a contract that cannot receive ERC-1155 transistors. Claim from a regular wallet.',

  // landing call-to-action
  'drop.l.tag': 'Starter kit',
  'drop.l.text': 'Get {n} free NAND to tape out your first neuron',
  'drop.l.left': '{n} kits left',
  'drop.l.cta': 'Start building',
}
