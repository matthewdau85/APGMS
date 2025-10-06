import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enAU from "./locales/en-AU/common.json";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      "en-AU": {
        translation: enAU,
      },
    },
    lng: "en-AU",
    fallbackLng: "en-AU",
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  })
  .catch((error) => {
    console.error("i18n initialisation failed", error);
  });

export default i18n;
