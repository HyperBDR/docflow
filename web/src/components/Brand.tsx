export default function Brand({ large = false }: { large?: boolean }) {
  return <span className={`brand-lockup ${large ? 'large' : ''}`}>
    <img src="/docflow-mark.svg" alt="" aria-hidden="true" />
    <span><strong>DocFlow</strong>{large && <small>INTERACTIVE DOCUMENTATION</small>}</span>
  </span>
}
