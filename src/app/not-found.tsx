import Link from "next/link";

export default function NotFound() {
  return (
    <div className="home">
      <header className="top">
        <Link className="mark" href="/">
          Сверка
        </Link>
      </header>
      <main className="empty">
        <h1>Такой проверки нет</h1>
        <p>Проверьте ссылку: возможно, она скопирована не целиком.</p>
        <Link className="primary link" href="/">
          Новая проверка
        </Link>
      </main>
    </div>
  );
}
