import { CheckForm } from "./CheckForm";

export default function Home() {
  return (
    <div className="home">
      <main className="home-grid">
        <section className="pitch">
          <h1>Реклама обещает. Сайт выполняет?</h1>
          <p className="lead">
            Сравниваем объявление со страницей, на которую оно ведёт. Через полминуты - оценка <span className="nowrap">от 0 до 100</span> и готовые правки текста.
          </p>
          <ol className="steps">
            <li>
              <b>Сверяем</b>
              <span>слова объявления с заголовком, кнопками и текстом страницы.</span>
            </li>
            <li>
              <b>Предлагаем</b>
              <span>что заменить и на какой текст. Сначала самое важное, без общих советов.</span>
            </li>
            <li>
              <b>Решаете вы</b>
              <span>принять или отклонить каждую правку. Принятые собираются в один список.</span>
            </li>
          </ol>
        </section>
        <CheckForm />
      </main>
      <footer className="foot">
        <span className="mark">Сверка</span>
        <p>Сервис читает только текст страницы и ничего на ней не меняет. Правки предлагает нейросеть, решение за вами.</p>
      </footer>
    </div>
  );
}
