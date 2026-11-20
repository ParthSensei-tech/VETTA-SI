import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { FAQS } from "../content/site";
import { Section } from "../ui/section";

export function Faq() {
  return (
    <Section id="faq" eyebrow="Questions" title="Frequently asked">
      <Accordion.Root type="single" collapsible className="mt-10 flex max-w-3xl flex-col gap-3">
        {FAQS.map((f, i) => (
          <Accordion.Item key={f.q} value={`q${i}`} className="l-glass rounded-2xl px-5">
            <Accordion.Header>
              <Accordion.Trigger className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-l-text [&[data-state=open]>svg]:rotate-180">
                {f.q}
                <ChevronDown
                  className="size-4 shrink-0 text-mint transition-transform duration-200"
                  aria-hidden="true"
                />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="l-acc-content overflow-hidden text-sm leading-relaxed text-l-muted">
              <p className="pb-5">{f.a}</p>
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </Section>
  );
}