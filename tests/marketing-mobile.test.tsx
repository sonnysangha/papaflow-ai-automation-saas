import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The public pages on a phone.
 *
 * What a unit test can hold onto here is the markup: that the sheet is the *whole* nav on a phone
 * (the header hides its own links below `md`, so a link missing from the sheet is a link nobody on
 * a phone can reach), that the sizing classes which make a control a 44px target are actually on
 * the controls, and that the one call to action the phone header has room for is there in both
 * auth states. Everything about how it looks at 320px is checked with a browser instead.
 *
 * `<Show>` is mocked because Clerk's is a client component that reads a provider this environment
 * has none of; the mock renders whichever branch the test asks for, which is how both the
 * signed-out pair ("Sign in" + "Get started") and the signed-in "Open app" get rendered at all.
 */

const showState = { signedIn: false };

vi.mock("@clerk/nextjs", () => ({
  Show: ({
    children,
    fallback,
  }: {
    when?: string;
    children?: React.ReactNode;
    fallback?: React.ReactNode;
  }) => (showState.signedIn ? children : fallback) ?? null,
}));

const { MARKETING_NAV } = await import("@/components/marketing/nav");
const { MobileNavContents } = await import("@/components/marketing/MobileNav");
const { SiteHeader } = await import("@/components/marketing/SiteHeader");
const { SiteFooter } = await import("@/components/marketing/SiteFooter");
const { PublicForm } = await import("@/components/forms/PublicForm");

function render(node: React.ReactNode, signedIn = false): string {
  showState.signedIn = signedIn;
  try {
    return renderToStaticMarkup(node);
  } finally {
    showState.signedIn = false;
  }
}

/** `h-11`, `size-11`, `min-h-11` — the classes that make a phone control 44px tall. */
const TAP_TARGET = /(?:min-h|size|h)-11/;

describe("the mobile nav sheet", () => {
  const html = render(<MobileNavContents />);

  it("lists every nav link the desktop header has", () => {
    expect(MARKETING_NAV.length).toBeGreaterThan(0);
    for (const item of MARKETING_NAV) {
      expect(html).toContain(`href="${item.href}"`);
      expect(html).toContain(item.label);
    }
  });

  it("carries both calls to action signed out, and the app link signed in", () => {
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Get started");

    const signedIn = render(<MobileNavContents />, true);
    expect(signedIn).toContain('href="/w"');
    expect(signedIn).toContain("Open app");
  });

  it("gives every row a 44px touch target", () => {
    for (const row of html.match(/<a [^>]*class="[^"]*"/g) ?? []) {
      expect(row).toMatch(TAP_TARGET);
    }
  });
});

describe("the public header", () => {
  const html = render(<SiteHeader />);

  it("keeps the wordmark, the theme control, one auth control and the menu", () => {
    expect(html).toContain("PapaFlow");
    expect(html).toContain('aria-label="Change theme"');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('href="/sign-in"');
  });

  it("leaves the second call to action to the sheet until there is room for it", () => {
    // "Get started" is in the header markup, but hidden until `sm` — the phone row has room for
    // exactly one auth control, and the sheet is where the other one lives.
    const getStarted = html.match(/<a [^>]*href="\/sign-up"[^>]*>/)?.[0] ?? "";
    expect(getStarted).toContain("hidden");
    expect(getStarted).toContain("sm:inline-flex");
  });

  it("sizes the phone controls as touch targets that stand down at sm", () => {
    for (const attr of ['aria-label="Change theme"', 'aria-label="Open menu"']) {
      const tag = html.match(new RegExp(`<button [^>]*${attr}[^>]*>`))?.[0] ?? "";
      expect(tag).toMatch(/size-11/);
      expect(tag).toMatch(/sm:size-/);
    }
  });
});

describe("the footer", () => {
  const html = render(<SiteFooter />);

  it("stacks into columns of 44px rows", () => {
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/docs"');
    for (const link of html.match(/<a [^>]*class="[^"]*"/g) ?? []) {
      // The wordmark is a lockup rather than a row; it pads to 44 instead of setting a height.
      expect(link).toMatch(/min-h-11|py-2\.5/);
    }
  });
});

describe("the public form", () => {
  const html = render(
    <PublicForm
      workflowId="wf_1"
      spec={{
        title: "Work with us",
        description: "Tell us about your project.",
        submitLabel: "Send",
        fields: [
          { name: "name", label: "Your name", type: "text", required: true },
          { name: "notes", label: "Notes", type: "textarea", required: false },
        ],
      }}
    />,
  );

  it("renders every field full width", () => {
    expect(html).toContain("Your name");
    expect(html).toContain("Notes");
    expect(html).toMatch(/<input [^>]*class="[^"]*w-full/);
  });

  it("gives the inputs and the submit button 44px on a phone", () => {
    const input = html.match(/<input [^>]*class="[^"]*"/)?.[0] ?? "";
    expect(input).toMatch(/h-11/);
    expect(input).toMatch(/sm:h-9/);

    const submit = html.match(/<button [^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toMatch(/h-11/);
    expect(submit).toContain("w-full");
  });
});
