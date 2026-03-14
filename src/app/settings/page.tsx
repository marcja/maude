/**
 * src/app/settings/page.tsx
 *
 * Server component that reads settings directly from SQLite and passes them
 * as props to the SettingsForm client component. This eliminates the mount-time
 * fetch, loading spinner, and load error state that the old client component had.
 */

import SettingsForm from '../../components/settings/SettingsForm';
import { getSettings } from '../../lib/server/db';

export default async function SettingsPage() {
  const settings = getSettings();
  return <SettingsForm initialSettings={settings} />;
}
