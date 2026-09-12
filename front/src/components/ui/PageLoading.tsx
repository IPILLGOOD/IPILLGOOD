// Opt in per route: the root, medication details and profile recovery need
// their original redirect/error HTTP status before sending a response body.
export default function PageLoading() {
  return (
    <section className="route-loading" role="status" aria-label="화면 불러오는 중">
      <span className="sr-only">화면을 불러오고 있어요.</span>
      <div className="route-loading__heading" aria-hidden="true">
        <span className="route-loading__line route-loading__line--short" />
        <span className="route-loading__line route-loading__line--title" />
        <span className="route-loading__line" />
      </div>
      <div className="route-loading__card" aria-hidden="true">
        <span className="route-loading__line route-loading__line--short" />
        <span className="route-loading__line" />
        <span className="route-loading__line" />
      </div>
      <div className="route-loading__card" aria-hidden="true">
        <span className="route-loading__line route-loading__line--short" />
        <span className="route-loading__line" />
      </div>
    </section>
  );
}
