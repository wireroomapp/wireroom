// Community rules, terms of use and privacy notice, shown in the Community panel and agreed to at
// sign-up. Plain-language draft written for Wire Room (Nov 2026); not reviewed by a lawyer yet.
export const RULES_VERSION = "2026-11-19";

export function RulesText() {
  return (
    <div className="cm-rules">
      <h2>Community rules</h2>
      <p className="cm-fine">Version of {RULES_VERSION}. Posts are public: anyone can read them, signed in or not.</p>
      <ul>
        <li><b>Show your sources.</b> Link the reports your analysis is based on, and say when something is your guess.</li>
        <li><b>Argue with ideas, not people.</b> No harassment, hate, slurs or threats, and no cheering on violence.</li>
        <li><b>No private information.</b> Don't post anyone's home address, phone number, private photos or other personal details, and don't help find someone.</li>
        <li><b>No illegal content</b>, and nothing that helps someone hurt people (weapons instructions, attack planning).</li>
        <li><b>Be yourself.</b> Don't pretend to be someone else, a government or a news outlet.</li>
        <li><b>No spam</b>, ads or repeated posting of the same thing.</li>
        <li><b>Respect copyright.</b> Link to articles and quote a sentence or two at most; don't paste whole articles.</li>
      </ul>
      <p>Anyone signed in can report a post, comment or account. Moderators can hide posts and comments and suspend accounts that break these rules, without notice.</p>

      <h3>Terms of use</h3>
      <ul>
        <li>You must be <b>13 or older</b> to have an account.</li>
        <li>You keep ownership of what you post. By posting, you let Wire Room show it, store it and display it on the site and in shared links.</li>
        <li>You're responsible for what you post. Posts are users' own views and analysis, labelled ANALYST, and aren't checked or endorsed by Wire Room.</li>
        <li>Wire Room is offered as it is, free, with no guarantee it will always be available or accurate. Don't rely on it for decisions about anyone's safety.</li>
        <li>These rules may change; the version date above shows the latest.</li>
      </ul>

      <h3>Privacy</h3>
      <ul>
        <li><b>What we keep:</b> your Google sign-in (name, email and an account ID, stored by our database host, Supabase), the username, display name and bio you choose, and what you post, comment, follow and report.</li>
        <li><b>What's public:</b> your username, display name, bio, posts, comments and who you follow. Your email is never shown.</li>
        <li><b>What we don't do:</b> sell your data, show ads, or track you across other sites. Visit counts use GoatCounter, which doesn't use cookies.</li>
        <li><b>Delete your account any time</b> (your profile → Edit profile): your profile, posts, comments and follows are deleted. Reports you sent stay, without your name.</li>
        <li>Questions or requests: use the Feedback button at the top of the site.</li>
      </ul>
    </div>
  );
}
