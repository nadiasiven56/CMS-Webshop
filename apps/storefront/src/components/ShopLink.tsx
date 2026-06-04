/**
 * Link die de actieve `?shop=` query meedraagt zodat je niet onbedoeld van
 * shop wisselt tijdens navigeren. Wrapt react-router's <Link>.
 */
import { Link, type LinkProps } from 'react-router-dom';
import { withShopQuery } from '../api/shop-context';

export function ShopLink({ to, ...rest }: LinkProps) {
  const href = typeof to === 'string' ? withShopQuery(to) : to;
  return <Link to={href} {...rest} />;
}
