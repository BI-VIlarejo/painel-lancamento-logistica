import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import styles from "./PaginatedTable.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";

type PaginatedTableProps<T> = {
  items: T[];
  label: string;
  children: (pageItems: T[], startIndex: number) => ReactNode;
};

const pageSizeOptions = [10, 25, 50];

export function PaginatedTable<T>({ items, label, children }: PaginatedTableProps<T>) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const startIndex = items.length ? currentPage * pageSize : 0;
  const endIndex = Math.min(startIndex + pageSize, items.length);

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, Math.ceil(items.length / pageSize) - 1)));
  }, [items.length, pageSize]);

  return <>
    <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label={`${label} — tabela`} tabIndex={0}>
      {children(items.slice(startIndex, endIndex), startIndex)}
    </div>
    <div className={cx(styles, commonStyles, "table-pagination")} role="group" aria-label={`Paginação de ${label}`}>
      <label className={cx(styles, commonStyles, "page-size-control")}>
        <span>Linhas</span>
        <select aria-label={`Linhas por página em ${label}`} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}>
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <span className={cx(styles, commonStyles, "table-page-summary")}>{items.length ? `${startIndex + 1}–${endIndex} de ${items.length}` : "0 resultados"}</span>
      <div className={cx(styles, commonStyles, "table-page-controls")}>
        <button type="button" aria-label={`Página anterior de ${label}`} title="Página anterior" disabled={currentPage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>‹</button>
        <span>{currentPage + 1} / {pageCount}</span>
        <button type="button" aria-label={`Próxima página de ${label}`} title="Próxima página" disabled={currentPage + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>›</button>
      </div>
    </div>
  </>;
}
