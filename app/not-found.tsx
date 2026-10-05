import Link from "next/link";

export default function NotFound() {
  return (
    <section className="shell not-found">
      <p className="kicker">404 / LOST NOTE</p>
      <h1>这一页还没有被写下来。</h1>
      <p>也许链接过期了，或者它还只是一个没有完成的想法。</p>
      <Link className="button button-primary" href="/">回到首页 →</Link>
    </section>
  );
}
