import commonStyles from "../styles/common.module.css";
import { cx } from "../styles/classNames";

type Props = { label: string };

export function LoadingState({ label }: Props) {
  return <div className={cx(commonStyles, "loading-card")} role="status" aria-live="polite">
    <span className={cx(commonStyles, "spinner spinner-green")} aria-hidden="true" />
    <span>{label}</span>
  </div>;
}
