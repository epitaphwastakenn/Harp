import { msg, useMessages } from "gt-react";

import { SETTINGS_SECTION_LABELS } from "./settingsSearch";

const settingsLabel = msg("Settings");

const settingsPageTitles: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": msg("Diagnostics"),
  "/settings/open-source-licenses": msg("Open source licenses"),
};

function settingsPageTitle(pathname: string): string {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return settingsPageTitles[normalizedPathname] ?? settingsLabel;
}

export function SettingsPageTitle({ pathname }: { pathname: string }) {
  const m = useMessages();
  return (
    <h1 className="min-w-0 truncate text-sm font-medium text-foreground">
      {m(settingsPageTitle(pathname))}
    </h1>
  );
}
