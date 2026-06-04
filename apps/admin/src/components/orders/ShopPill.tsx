/**
 * ShopPill — kleine herbruikbare pill die toont uit wélke shop een order komt.
 *
 * Gebruikt in de "Alle shops"-inbox (orders-lijst) waar orders van meerdere
 * shops door elkaar staan. Pure presentational: krijgt de al-geresolvede
 * shop-naam mee (page mapt shopId → naam via de shop-lijst uit shop-context).
 * Valt terug op een afgekapte shopId als de naam (nog) niet bekend is.
 */

/** Deterministische tint per shop zodat shops visueel onderscheidbaar blijven. */
const SHOP_TINTS = [
  '#ff9f43',
  '#4285f4',
  '#34c759',
  '#af52de',
  '#ff375f',
  '#5ac8fa',
  '#ffd60a',
  '#64d2ff',
];

function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SHOP_TINTS[h % SHOP_TINTS.length]!;
}

export function ShopPill({ shopId, name }: { shopId: string; name?: string | null }) {
  const label = name?.trim() || `${shopId.slice(0, 8)}…`;
  const color = tintFor(shopId);
  const letter = (name?.trim()?.[0] ?? shopId[0] ?? '?').toUpperCase();
  return (
    <span
      className="badge"
      style={{
        background: 'transparent',
        borderColor: 'var(--border-default)',
        color: 'var(--theme-text)',
        gap: 6,
        paddingLeft: 4,
        maxWidth: 180,
      }}
      title={label}
    >
      <span
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 16,
          height: 16,
          borderRadius: 4,
          background: color,
          color: '#fff',
          fontSize: 9.5,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {letter}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </span>
  );
}
