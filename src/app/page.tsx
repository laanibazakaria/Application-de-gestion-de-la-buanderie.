import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("app");
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-bold">{t("name")}</h1>
      <p className="mt-2">{t("tagline")}</p>
    </main>
  );
}
