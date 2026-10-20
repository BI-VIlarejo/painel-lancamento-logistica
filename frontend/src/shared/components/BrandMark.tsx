import styles from "./BrandMark.module.css";
import commonStyles from "../styles/common.module.css";
import { cx } from "../styles/classNames";
import logo from "../../../logo-vilarejo.png";

export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <div className={cx(styles, commonStyles, `brand-mark${light ? " brand-mark-light" : ""}`)}>
      <span className={cx(styles, commonStyles, "brand-symbol")}><img src={logo} alt="" /></span>
      <div className={cx(styles, commonStyles, "brand-wordmark")}><strong>Vilarejo</strong><span>Logística</span></div>
    </div>
  );
}
