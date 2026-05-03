"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SOURCES = ["manual", "etsy", "form", "import"] as const;

export default function ContactIngressPage() {
  const [fields, setFields] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    source: "manual" as string,
    notes: "",
    tags: "",
  });
  const [status, setStatus] = useState<{ ok: boolean; slug?: string; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFields(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    const tags = fields.tags
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);
    try {
      const res = await fetch("/api/contact-ingress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, tags }),
      });
      const data = await res.json();
      setStatus(data.ok ? { ok: true, slug: data.slug } : { ok: false, error: data.error });
      if (data.ok) setFields({ name: "", company: "", email: "", phone: "", source: "manual", notes: "", tags: "" });
    } catch {
      setStatus({ ok: false, error: "network error" });
    } finally {
      setLoading(false);
    }
  }

  const router = useRouter();

  return (
    <div className="flex flex-col h-full">
      {/* Nav header — matches slug page style */}
      <div className="shrink-0 px-4 py-2 border-b border-rule/30 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          className="shrink-0 text-[10px] text-dim hover:text-accent transition-colors font-mono"
          title="back"
        >
          ←
        </button>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-dim">
          add contact
        </span>
      </div>

    <div className="flex-1 overflow-auto p-6 max-w-lg">
      <div className="text-[11px] font-mono text-dim mb-1">wf-contact-ingress</div>
      <h1 className="text-[15px] font-semibold text-primary mb-5">Add contact</h1>

      <form onSubmit={submit} className="space-y-3">
        {[
          { key: "name", label: "Name *", placeholder: "Sarah Chen" },
          { key: "company", label: "Company", placeholder: "Pacific Style Wholesale" },
          { key: "email", label: "Email", placeholder: "sarah@example.com" },
          { key: "phone", label: "Phone", placeholder: "(206) 555-0142" },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-[11px] text-dim mb-1">{label}</label>
            <input
              type="text"
              value={(fields as Record<string, string>)[key]}
              onChange={set(key)}
              placeholder={placeholder}
              required={key === "name"}
              className="w-full bg-base border border-rule/40 rounded px-3 py-1.5 text-[13px] text-primary placeholder:text-dim/50 focus:outline-none focus:border-rule"
            />
          </div>
        ))}

        <div>
          <label className="block text-[11px] text-dim mb-1">Source</label>
          <select
            value={fields.source}
            onChange={set("source")}
            className="w-full bg-base border border-rule/40 rounded px-3 py-1.5 text-[13px] text-primary focus:outline-none focus:border-rule"
          >
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-dim mb-1">Tags (comma-separated)</label>
          <input
            type="text"
            value={fields.tags}
            onChange={set("tags")}
            placeholder="buyer, vip, atv"
            className="w-full bg-base border border-rule/40 rounded px-3 py-1.5 text-[13px] text-primary placeholder:text-dim/50 focus:outline-none focus:border-rule"
          />
        </div>

        <div>
          <label className="block text-[11px] text-dim mb-1">Notes</label>
          <textarea
            value={fields.notes}
            onChange={set("notes")}
            rows={3}
            placeholder="Any relevant context..."
            className="w-full bg-base border border-rule/40 rounded px-3 py-1.5 text-[13px] text-primary placeholder:text-dim/50 focus:outline-none focus:border-rule resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-[#0098fd]/10 border border-[#0098fd]/30 text-[#0098fd] text-[13px] rounded hover:bg-[#0098fd]/20 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {loading ? "Adding..." : "Add contact → substrate"}
        </button>
      </form>

      {status && (
        <div className={`mt-4 p-3 rounded border text-[12px] font-mono ${
          status.ok
            ? "border-green-800/40 bg-green-900/10 text-green-400"
            : "border-red-800/40 bg-red-900/10 text-red-400"
        }`}>
          {status.ok ? `✓ staked: ${status.slug} — contacts list updated` : `✗ ${status.error}`}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-rule/20 text-[11px] text-dim space-y-1">
        <div>Raw contact → ingress → substrate → viewer live update</div>
        <div className="font-mono text-dim/60">POST /api/contact-ingress</div>
      </div>
    </div>
    </div>
  );
}
