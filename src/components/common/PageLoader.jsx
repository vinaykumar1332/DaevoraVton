import './PageLoader.css';

/** Skeleton shown while a lazy screen loads. */
export default function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-label="Loading">
      <div className="pl-bar pl-title" />
      <div className="pl-grid">
        <div className="pl-bar pl-card" />
        <div className="pl-bar pl-card" />
      </div>
    </div>
  );
}
