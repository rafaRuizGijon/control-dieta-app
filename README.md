# NutriPlan Pro - Control de Dieta Semanal y Recetario

Aplicación web construida con **React + Vite + Tailwind CSS** y base de datos gratuita en **Supabase** (PostgreSQL). Incluye precargadas las **56 recetas** de la pestaña *Recetario y Fichas* de tu Excel con todos sus ingredientes, métodos de preparación y desglose nutricional completo.

## Funcionalidades
- **Recetario completo:** Consulta ingredientes, cantidades, pasos de preparación y los 9 parámetros nutricionales (Porción, Energía, Proteínas, Hidratos, Azúcares, Grasas, Grasas Saturadas, Fibra y Sodio).
- **Creación de nuevas recetas:** Formulario integrado para añadir recetas personalizadas a la base de datos.
- **Planificador semanal:** Asigna recetas por día (Lunes a Domingo) y por ingesta (Desayuno, Media Mañana, Comida, Merienda, Cena) o usa el botón de autogeneración.
- **Cálculo nutricional automático:** Suma en tiempo real los macronutrientes y micronutrientes totales de cada día y el promedio semanal.

---

## Guía de Despliegue Gratuito (GitHub + Supabase + Vercel)

### 1. Crear la Base de Datos gratuita en Supabase
1. Entra en [supabase.com](https://supabase.com), crea una cuenta gratuita y pulsa **New Project**.
2. Ve al menú lateral **SQL Editor**, pega el contenido del archivo `supabase_schema.sql` de este proyecto y pulsa **Run**.
3. Ve a **Project Settings > API** y copia:
   - `Project URL`
   - `anon public` key

### 2. Subir el código a GitHub
1. Crea un repositorio nuevo en [github.com](https://github.com).
2. Sube todos los archivos de esta carpeta al repositorio:
   ```bash
   git init
   git add .
   git commit -m "Versión inicial NutriPlan Pro"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

### 3. Desplegar gratis en Vercel
1. Entra en [vercel.com](https://vercel.com) e inicia sesión con tu cuenta de GitHub.
2. Pulsa **Add New > Project** e importa tu repositorio.
3. En la sección **Environment Variables**, añade las dos claves de Supabase:
   - `VITE_SUPABASE_URL` = tu Project URL
   - `VITE_SUPABASE_ANON_KEY` = tu clave anon public
4. Pulsa **Deploy**. En menos de 1 minuto tendrás tu URL pública funcionando. Al abrirla por primera vez, la app subirá automáticamente las 56 recetas del Excel a tu base de datos Supabase.
