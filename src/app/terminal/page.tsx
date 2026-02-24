import { TerminalPage } from '../TerminalPage';

// The /terminal route renders the standalone terminal page.
// A default sessionId is used; deep-linking with a specific session
// is handled via /session/[id].
export default function Page() {
  return <TerminalPage sessionId="default" />;
}
