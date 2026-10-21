import Link from "next/link";
import { MOCKUP_LINKS } from "./fixtures";
import { MockupPage, mockupCard, mockupMuted, mockupRadius } from "./chrome";

export function MockupIndex() {
  const groups: string[] = [];
  for (const link of MOCKUP_LINKS) {
    if (!groups.includes(link.group)) groups.push(link.group);
  }

  return (
    <MockupPage
      kicker="Admin"
      title="Mockups"
      lede="Click through the pending screens. Controls on these pages stay in the browser."
    >
      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group} aria-labelledby={`group-${group}`}>
            <h2 id={`group-${group}`} className="text-lg font-semibold">
              {group}
            </h2>
            <ul className="mt-3 space-y-3">
              {MOCKUP_LINKS.filter((link) => link.group === group).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`${mockupCard} block hover:bg-[var(--ts-band-shows)]`}
                    style={mockupRadius}
                  >
                    <p className="font-medium">{link.label}</p>
                    <p className={mockupMuted}>{link.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </MockupPage>
  );
}
