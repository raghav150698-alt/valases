import { useEffect, useState } from "react";
import { CheckCircle2, FileSignature } from "lucide-react";
import { api } from "../../lib/api";

type PublicOffer = {
  offer_reference: string;
  status: string;
  company_name: string;
  company_logo_url: string;
  candidate_name: string;
  job_title: string;
  currency: string;
  total_ctc: number;
  pay_frequency: string;
  start_date: string | null;
  expires_at: string | null;
  document_html: string;
  can_respond: boolean;
  expired: boolean;
};

export function CandidateOfferPanel({ offerKey }: { offerKey: string }) {
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [signatureName, setSignatureName] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState("");

  useEffect(() => {
    api.get<PublicOffer>(`/hiring/offers/public/${encodeURIComponent(offerKey)}`)
      .then(({ data }) => {
        setOffer(data);
        setSignatureName(data.candidate_name);
      })
      .catch((reason) => setError(String(reason?.response?.data?.detail || "This offer link is unavailable.")))
      .finally(() => setLoading(false));
  }, [offerKey]);

  const decide = async (accepted: boolean) => {
    if (!consent || signatureName.trim().length < 2) return;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await api.post(`/hiring/offers/public/${encodeURIComponent(offerKey)}/decision`, {
        signature_name: signatureName.trim(),
        accepted,
        consent,
      });
      setCompleted(data.status);
    } catch (reason: any) {
      setError(String(reason?.response?.data?.detail || "Your response could not be saved."));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <section className="candidate-offer-state"><span className="candidate-loading-spinner" /><p>Loading your offer...</p></section>;
  if (error && !offer) return <section className="candidate-offer-state"><h1>Offer unavailable</h1><p>{error}</p></section>;
  if (!offer) return null;
  if (completed) return <section className="candidate-offer-state"><CheckCircle2 size={44} /><h1>{completed === "accepted" ? "Offer accepted" : "Response recorded"}</h1><p>{completed === "accepted" ? "A signed copy has been emailed to you and the recruiter." : "The recruiter has been notified of your decision."}</p></section>;

  return <div className="candidate-offer-page">
    <header className="candidate-offer-company">
      {offer.company_logo_url ? <img src={offer.company_logo_url} alt={`${offer.company_name} logo`} /> : null}
      <div><span>Employment offer</span><strong>{offer.company_name}</strong></div>
    </header>
    <section className="candidate-offer-summary">
      <div><small>Position</small><strong>{offer.job_title}</strong></div>
      <div><small>Total compensation</small><strong>{offer.currency} {Number(offer.total_ctc || 0).toLocaleString()} / {offer.pay_frequency}</strong></div>
      <div><small>Offer reference</small><strong>{offer.offer_reference}</strong></div>
      <div><small>Respond by</small><strong>{offer.expires_at ? new Date(offer.expires_at).toLocaleDateString() : "No expiry"}</strong></div>
    </section>
    <iframe className="candidate-offer-document" title="Offer letter" sandbox="" srcDoc={offer.document_html} />
    {offer.can_respond ? <section className="candidate-offer-signature">
      <div><FileSignature size={22} /><span><strong>Electronic signature</strong><small>Type your full legal name and confirm your consent.</small></span></div>
      <label>Full legal name<input value={signatureName} onChange={(event) => setSignatureName(event.target.value)} /></label>
      <label className="candidate-offer-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree that typing my name constitutes my electronic signature and that I have reviewed this offer.</span></label>
      {error && <p className="candidate-offer-error">{error}</p>}
      <footer><button type="button" className="candidate-offer-decline" disabled={submitting || !consent} onClick={() => void decide(false)}>Decline</button><button type="button" className="candidate-offer-accept" disabled={submitting || !consent || signatureName.trim().length < 2} onClick={() => void decide(true)}>{submitting ? "Saving..." : "Accept and sign"}</button></footer>
    </section> : <section className="candidate-offer-closed"><strong>{offer.expired ? "This offer has expired." : `This offer is ${offer.status}.`}</strong></section>}
  </div>;
}
