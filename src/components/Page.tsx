import React, { useEffect } from "react";
import { PageMeta, useHelpContext } from "../help/HelpContext";

type PageProps = {
  meta: PageMeta;
  children: React.ReactNode;
};

export default function Page({ meta, children }: PageProps) {
  const { setPageMeta } = useHelpContext();

  useEffect(() => {
    setPageMeta(meta);
    if (typeof document !== "undefined" && meta.title) {
      document.title = `APGMS – ${meta.title}`;
    }
    return () => setPageMeta(undefined);
  }, [meta, setPageMeta]);

  return <>{children}</>;
}
