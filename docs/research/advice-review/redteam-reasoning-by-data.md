# RED TEAM: ветка DATA атакует REASON-1…7

2026-10-06. Проверен `/tmp/pesiki-research-reasoning.md`; сопоставлено с текущими advice-*.ts, live-advice.ts и результатами source/coverage audit. Ниже атакуются именно гипотезы, не автор. Severity относится к исходной реализации без предложенного исправления. Go-тесты — проектные эксперименты, не доказанная статистическая мощность.

## REASON-1 — typed mechanics graph

**Вердикт: REVISE. Severity: MAJOR; FATAL, если graph-valid подаётся как достаточное доказательство рекомендации.**

**Самый сильный контрпример.** В каталоге правильно доказано: эффект предмета снимает конкретный debuff с владельца. Но игрок не может активировать предмет в состоянии этого контроля, уже погибает до применения, должен защищать союзника, либо эффект сразу накладывается повторно. Даже идеальный `resolves` не доказывает `can_execute_now`, возможность удерживать дистанцию, приоритет и лучшее использование золота. Истинное «этот предмет даёт подходящий эффект» превращается в ложное «тебе надо купить его следующим». Более того, verified объяснение может быть приложено к объективно слабой покупке из плохого candidate set.

**Скрытая стоимость.** 15–25 предметов × десятки вражеских способностей × несколько компонентов × состояния кастера/цели × facet/upgrades × патчи — это не маленькие 15–25 записей. При буквальном per-effect graph малый стак получает обязанность поддерживать мини-вики с тестами клиента. Текущий provider не даёт уровень способностей, cooldown, facet, learned-upgrade state; граф будет содержать много predicates, которые нельзя установить. Revision dotaconstants не закрывает это.

**Псевдодоказательство.** «60 правильных interaction tests» в основном проверяет совпадение ручной таблицы с ручными expected values. Если автор таблицы и тестов один, систематическая ошибка полностью проходит. Даже независимый correct-edge audit не оценивает ranking.

**Как станет бесполезным, оставаясь верным.** Для каждой покупки получится «может помочь при X, если Y, кроме Z»; игрок получает энциклопедическую карточку вместо ясного tradeoff. Каталог охватит только лёгкие защитные правила и никогда не предложит ключевой offensively correct предмет.

**Необходимое изменение.** Не общий graph, а узкая библиотека 8–12 decision recipes, выбранных по частоте настоящих вопросов/ошибок. Разделить 3 outputs: факт эффекта; условная применимость; предпочтение покупки. У каждого отдельный статус и источник. Сначала exact recipient/dispel/pierce veto и несколько проверенных exceptions; не обещать закрыть все контрпары. В review log фиксировать независимую проверку и источник не из той же таблицы. Непроверенная возможность применения остаётся условием, не becomes true.

**Решающий kill-test.** Timebox создания и одной имитации patch update. На 50 новых decision snapshots эксперты оценивают не mechanics только, а совет целиком. У graph-подхода должны снизиться harmful choices против простого curated baseline без потери полезного coverage. Дополнительно в каждую валидную interaction пару внести execution-blocking predicate; рекомендация не должна оставаться безусловной. Если maintenance растёт быстрее новых полезных советов либо edge correctness растёт, а usefulness нет — графовую амбицию убить, оставить узкие veto/templates.

## REASON-2 — typed context + compact retrieval

**Вердикт: SURVIVE с обязательным изменением. Severity: MAJOR.**

**Контрпример.** Система идеально различила ally/enemy, но для следующей покупки выбрала 3–6 proof-valid кандидатов из обрезанных 32. Настоящий лучший предмет был вытеснен popularity и вообще не дошёл до reasoning. `Exact IDs` защищают от путаницы имён, но не от неверной team normalization или source identity; один ошибочный teamId делает весь bundle стройно неверным. Неизвестный snapshot timestamp, интерпретированный как current, даёт формально типизированную ложь.

**Цена.** Два времени — event time и availability time — должны сохраняться через ingestion, кеш, модель и UI. Нельзя восстановить их только из now и заявленного delay. Поставщик может возвращать пропуски/partial/delta, а schema наличие не гарантирует полноту. Текущий код проверяет две команды по пять игроков, но это не доказывает полноту инвентарей.

**Псевдодоказательство.** Metamorphic invariance по перестановке проверяет стабильность модели, не правильность мирового состояния. Требование «меняется только соответствующий claim» слишком сильное: перестановка героя между командами может изменить общую стратегию всех союзников.

**Формально верный провал пользы.** Ограничение 3–6 кандидатов делает rationale проще и качественнее, но только потому, что удалены реальные tradeoffs. Модель обоснованно выбирает лучшее из плохого списка.

**Исправление.** Держать большой candidate audit pool до compact retrieval; измерять recall independently от качества объяснения. Фиксировать source event time, availability, missingness и identity confidence. Metamorphic тесты разделить на identity-preserving (перестановка массивов) и world-changing (смена команды героя); вторые должны иметь ожидания допустимого изменения, не тотальную invariance.

**Kill-test.** Dataset 40 snapshots с экспертным acceptable set до генерации. Проверить candidate recall до/после compression, ошибочную нормализацию team и unknown inventories. Go при нулевых team/temporal contradictions и сохранённом recall; no-go для конкретной compression стратегии при потере приемлемых редких choices. Typed ID/context оставить в любом случае.

## REASON-3 — ограниченный планировщик

**Вердикт: REVISE. Severity: MAJOR.**

**Контрпример.** Планировщик считает завершение предмета дешёвым: компоненты в видимых слотах есть. Но игрок уже купил другую часть на курьере, копит на buyback, скоро продаёт компонент или его роль требует иной tempo. Все candidate bundle арифметически правильны по snapshot, а ранжирование неверно. Добавление `hold gold` особенно опасно: без надёжной цены buyback/cooldown/плана это выглядит осторожно, но может проигрывать очевидному полезному компоненту.

**Цена/данные.** Вход не содержит intentions и полного inventory; role null. Для оценки offensive tradeoff нужны attack/ability scaling, spell usage, facet и способность игрока реализовать combo, а не только counter coverage. Источник purchase popularity не даёт сравнительного utility. «Признаки отдельно» — всё ещё не определённый алгоритм ранжирования.

**Псевдодоказательство.** Эксперты часто согласятся с любым plausible BKB/Force, особенно видя убедительный текст. 80% «разумно» может пройти система, которая никогда не выбирает лучший offensive timing. Это не лучшее качество, а лояльная rubric. Игроку нужен следующий шаг; reasonable set не равен полезному ranking.

**Бесполезность без фактических ошибок.** Система бесконечно предлагает defensive utility как безопасный универсальный ответ, хотя стак кайфанёт от точного объяснения, когда можно продолжить damage/tempo. Всё формально применимо и уныло.

**Исправление.** Явно определить baseline: static hero-role plan + verified counter veto. Не добавлять много action classes до независимого сравнения. Для каждого snapshot эксперт сначала без модели записывает главную decision need и acceptable/dominated choices; затем слепо сравнивает выбор, затем объяснение. Разделить role-known и role-unknown результаты. `Hold` только с конкретным проверенным основанием, не универсальная abstention.

**Kill-test.** 30 offensive/tempo решений + 30 defensive/utility и 20 sunk-cost ловушек. Если planner улучшает лишь mechanics и проигрывает baseline по decision priority или начинает чаще hold/ask без роста пользы — no-go на сложный ranking. Достаточно оставить transparent top-2 alternatives с честным условием, без якобы оптимального utility score.

## REASON-4 — team allocation

**Вердикт: REVISE. Severity: MAJOR.**

**Контрпример.** Два наших игрока по очереди читают разные кешированные советы. На первом обновлении Pipe назначен A, на втором B чуть богаче — назначен B. A уже купил компоненты, B тоже начинает, сообщение формально оптимально по каждому snapshot и создаёт именно дублирование, которое обещало убрать. Другой случай: нужный utility у союзника есть, но он играет отдельно; inventory presence не означает доступный командный эффект.

**Цена.** Нужно persistent agreed plan/lock/ownership/expiry, понятный способ принятия и смены плана. Telegram message не auto-updates, website auto-updates; соглашение должно переживать разные каналы и account mapping. Без этого team allocation — свободный текст, не координация. Прямого planned/agreed данных observer не даёт.

**Псевдодоказательство.** Слепая экспертная оценка одного снапшота не проверяет, понимают ли два живых человека свои роли и не меняется ли assignment каждые две минуты. Stronger-looking global optimum может быть хуже стабильного локального плана.

**Бесполезность.** При одном нашем в матче «распределение командных нужд» ничего не распределяет. При неизвестных ролях у пяти наших генерируется 5 условных оговорок; никто не принимает решение.

**Исправление.** Stage 1: coordination flags только наших — «у нас уже есть X», «у двоих начинается X, договоритесь». Stage 2: explicit accepted plan с ручным owner и sticky assignment. Не inference agreement из компонентов. Глобальный solver до появления real coordination feedback не нужен.

**Kill-test.** Проиграть последовательности 10 матчей, не отдельные snapshots: число assignment reversals, конфликтов между старым Telegram и новым website, требуемых user actions. Малый живой тест с двумя игроками: могут ли за 10 секунд одинаково назвать план. Если нет — reject auto-allocation, сохранить duplicate-warning и opt-in planning.

## REASON-5 — selective abstention / patch quarantine

**Вердикт: REVISE. Severity: MAJOR.**

**Контрпример.** Patch неизвестен во всех 30 последних production матчах. Если unknown patch закрывает рекомендации целиком — coverage ноль. Если вручную назначить текущую дату патчу — historical evaluation получает неверную механику. Если unaffected rules автоматически сохраняются потому, что diff их не упомянул, статус verified не оправдан. Подпись confidence class делает неизвестное выглядящим измеренным.

**Цена.** Dependency graph + patch diff + spot check требуют своего maintenance owner и сроков. Что происходит, если патч вышел ночью, а owner отсутствует? Более тонкая claim-level abstention требует и объяснений, и тестов UI. Надёжные CI для <=1% ошибок требуют намного больше независимых случаев, чем 50–200 взаимозависимых решений; 200 player-decisions одного hero/patch не обеспечивают перенос.

**Псевдодоказательство.** `Useful question` посчитан полезным coverage: система может пройти 60% threshold, спрашивая очевидное «какая роль?» каждый матч. Вопрос — стоимость и потенциальная польза, не готовый полезный совет. Нужна отдельная denominator.

**Бесполезность.** «Если играешь support — X, если core — Y» повторяется независимо от реальной игры. Критических ошибок нет, внимания потребляет много.

**Исправление.** Разделить served advice coverage, answerable-question rate, user effort и correctness. Patch provenance: точный verified vs assumed epoch vs unknown; не выдавать certificate из timestamp. Stable general facts можно использовать условно, current-interaction rules требуют отдельной верификации. На старте policy простая, измеримые reject reasons; сложную risk curve отложить до разметки.

**Kill-test.** Replay patch rollout с unknown patch на всех входах + неделю отсутствующего maintainer. Система должна сохранить ограниченную полезность без false verified и без ежедневных повторяющихся вопросов. Оценка user attention отдельно. Если невозможно — сократить механический scope, не подменять unknown текущим патчем.

## REASON-6 — runtime adversarial verifier

**Вердикт: REJECT как обязательный runtime слой сейчас; SURVIVE как offline red-team инструмент. Severity: MAJOR.**

**Контрпример.** Шаблон уже строится из checked claims. Второй LLM «улучшает безопасность», отвергая корректный нетипичный tradeoff или пропуская misleading conclusion с теми же правдивыми словами. Добавляются latency/cost и общий provider outage, качество может стать хуже. Если исходные claims/graph ошибочны, verifier с тем же evidence неизбежно заверит ошибку. Выбор не того предмета он вообще не умеет обнаруживать в proposed narrow task.

**Цена.** Потребуется отдельный размеченный корпус verifier false positives/negatives, модели, retry/fallback semantics, latency budgets и drift audit. Для маленького стака эта работа может стоить дороже полезности свободных перефразировок. Stale snapshot после второй модели означает, что идеальный текст так и не показан.

**Псевдодоказательство.** Mutation benchmark часто проверяет искусственные single-token errors, которые явно легче реальных compositional omissions и плохой приоритизации. Высокий mutation recall нельзя назвать production reliability.

**Бесполезность.** Итоговый текст почти совпадает с шаблоном; второй вызов нужен ради ощущения multi-agent надёжности, а не пользовательской ценности.

**Исправление.** Один deterministic renderer + typed decision validation. LLM wording эксперимент отдельно, verifier только offline выборка или conditionally на нестандартный текст после доказанного incremental gain. Никакого обязательного second-model call до сравнения с template baseline.

**Kill-test.** Парно template vs LLM wording vs wording+verifier на одних decisions. Blind user utility, natural-error detection, latency и доля потерянных советов. Если verifier не улучшает end-to-end quality относительно template при той же coverage — runtime слой удалить. Не считать «ловит 90% мутантов» достаточным основанием.

## REASON-7 — decision benchmark

**Вердикт: SURVIVE. Severity: MINOR для замысла, MAJOR для неправильного вывода о rollout.**

**Контрпример.** Тренер-эксперт предпочитает своё представление о ranked Dota, а наши играют Turbo и хотят фана. Модель выигрывает expert leaderboard, но советы ощущаются чужими и тормозят игру. Historical replay screenshots без реального delay получают лучшую оценку, чем возможный production snapshot; такой benchmark награждает недоступную информацию.

**Цена.** Независимая разметка 200 решений по настоящему rich context занимает часы; disagreements требуют арбитража. Получить двух компетентных Turbo reviewers труднее, чем ещё один API. Формально rich production corpus не равен time-faithful observer reconstruction: exact inventory state и role намерения могут отсутствовать.

**Псевдодоказательство.** Handcrafted critical suite и holdout созданы тем же человеком после просмотра failures; freeze system не устраняет author selection bias. Zero critical на специально вылизанных кейсах не доказывает качество на новых матчах. Случаи по пять игроков одного матча — кластеры, не 5 независимых испытаний.

**Бесполезность.** Система оптимизирует «всё верно» и readability, но повторяет одно и то же; opportunity cost внимания не включён. Пользователь может не открыть ни одной карточки.

**Исправление.** Два набора: mechanics adversarial suite и естественно выбранные production decision windows без cherry-picking. Третий этап — opt-in user pilot, отдельно оценка enjoyability/attention/novel usefulness. Эксперты видят только then-available evidence; withheld future input проверяется специально. Использовать cluster-aware интервалы и публиковать disagreement. Не ждать 200 случаев для первой полезной правки, но не заявлять ультранадёжность по 20.

**Kill-test.** Замороженная система на следующей непрерывной серии матчей, заранее определённые decision windows, никаких замен неудобных кейсов. Сравнить оценку экспертов с оценкой самих игроков, считать дубли и unopened/ignored separately. Если expert score растёт, а игрокам не полезнее — менять target/rubric, не усложнять модель.

## Сводный отсев

Сохраняются без архитектурной революции: typed identities/time/unknowns; естественный decision ledger и benchmark; independent candidate recall audit; deterministic rendering.

Пересобрать: full mechanics graph → маленькая библиотека decision recipes + проверенные veto; planner → baseline-first bounded comparison; team allocation → сначала flags, затем accepted sticky plans; abstention → отдельные метрики советов, вопросов и внимания.

Не запускать по умолчанию: runtime adversarial verifier. Это не запрет исследования; это требование доказать выигрыш сверх templates.

**Самая опасная общая подмена:** проверенная связь предмета и эффекта не означает правильную следующую покупку. Если продукт станет «сертификатором правдивых объяснений для посредственных предметов», все семь гипотез могут пройти свои локальные тесты, а пользователю останется параша. Главный gate — полезный выбор и честный tradeoff на его реальном Turbo-контексте при приемлемой цене внимания.

## Усиление REASON-2: невалидированная семантика задержки

Root обнаружил ключевую недоказанную предпосылку: `game.delay=120` из GC SourceTV lobby может относиться к задержке просмотра DotaTV, а не к `teams/game_time` GetRealtimeStats. Без paired clock alignment нельзя складывать nominal spectator delay и local snapshot age и называть результат измеренной фактической задержкой endpoint. Это MAJOR, при точных now-советах FATAL.

Исправление: хранить nominalSpectatorDelay, receivedAt, sourceTimestamp с явно неизвестной semantics, estimatedSourceLag=null до калибровки. Эксперимент — сопоставить часы/событие реального игрока с timestamp/game_time API без новой конкурирующей Steam-сессии; несколько наблюдений, проверить как live, так и кеш. До этого объяснять «данные наблюдателя; фактическая задержка не измерена», не «точно 120 + age». Action-class restriction на стратегическое планирование остаётся разумной policy, но её основание — неопределённая свежесть/неполнота, не доказанные 120 секунд endpoint.
