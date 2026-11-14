import React, { useState, useEffect, useMemo } from 'react';
import { INITIAL_RECIPES } from './initialRecipes';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import {
  Utensils, Calendar, Plus, Search, Trash2, Eye, X, CheckCircle2,
  Database, HardDrive, Flame, Drumstick, Wheat, Droplet, Sparkles, Save, Copy, Tag, RefreshCw
} from 'lucide-react';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const INGESTAS = ['Desayuno', 'Media Mañana', 'Comida', 'Merienda', 'Cena'];

const CATEGORIAS_SUGERIDAS = [
  'Comida / Cena (Plato Principal)',
  'Comida / Cena (Entrante / Guarnición)',
  'Comida / Cena',
  'Desayuno / Merienda',
  'Postre / Merienda'
];

const createEmptyPlan = () => {
  const plan = {};
  DIAS.forEach(dia => {
    plan[dia] = {};
    INGESTAS.forEach(ing => {
      plan[dia][ing] = [];
    });
  });
  return plan;
};

const normalizeName = (str) => (str || '').trim().toLowerCase();

export default function App() {
  const [activeTab, setActiveTab] = useState('planificador');
  const [recipes, setRecipes] = useState([]);
  const [weeklyDiets, setWeeklyDiets] = useState([]);
  const [currentDietId, setCurrentDietId] = useState('dieta-actual');
  const [dietName, setDietName] = useState('Dieta Semanal Principal');
  const [plan, setPlan] = useState(createEmptyPlan());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);

  // Filtros y modales
  const [searchTerm, setSearchTerm] = useState('');
  const [originFilter, setOriginFilter] = useState('Todas');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [selectedRecipeModal, setSelectedRecipeModal] = useState(null);
  const [pickerTarget, setPickerTarget] = useState(null); // { dia, ingesta }
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState('Todas');

  // Formulario nueva receta
  const [newRecipe, setNewRecipe] = useState({
    nombre: '', origen: 'Personalizada', categoria: 'Comida / Cena (Plato Principal)',
    ingredientes: '', preparacion: '',
    porcion_g: '', kcal: '', proteina: '', hidratos: '', azucares: '',
    grasas: '', grasas_sat: '', fibra: '', sodio: ''
  });

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Sincroniza nuevas recetas de v5 y rellena el campo `categoria` en las existentes
  const syncCatalogWithDatabase = async (existingList, notify = false) => {
    setSyncing(true);
    try {
      const existingByName = new Map();
      existingList.forEach(r => existingByName.set(normalizeName(r.nombre), r));

      const toInsert = [];
      const toUpdateCategory = [];

      INITIAL_RECIPES.forEach(catalogRec => {
        const key = normalizeName(catalogRec.nombre);
        const found = existingByName.get(key);
        if (!found) {
          toInsert.push(catalogRec);
        } else if ((!found.categoria || found.categoria === 'General') && catalogRec.categoria) {
          toUpdateCategory.push({ id: found.id, categoria: catalogRec.categoria });
        }
      });

      let merged = [...existingList];

      if (isSupabaseConfigured) {
        if (toInsert.length > 0) {
          const { error } = await supabase.from('recetas').insert(toInsert);
          if (!error) {
            merged = [...merged, ...toInsert];
          }
        }
        for (const item of toUpdateCategory) {
          await supabase.from('recetas').update({ categoria: item.categoria }).eq('id', item.id);
        }
      } else {
        if (toInsert.length > 0) {
          merged = [...merged, ...toInsert];
        }
      }

      if (toUpdateCategory.length > 0) {
        const catMap = new Map(toUpdateCategory.map(u => [u.id, u.categoria]));
        merged = merged.map(r => (catMap.has(r.id) ? { ...r, categoria: catMap.get(r.id) } : r));
      }

      if (!isSupabaseConfigured) {
        localStorage.setItem('nutriplan_recetas', JSON.stringify(merged));
      }

      setRecipes(merged);
      if (notify) {
        showToast(`Catálogo actualizado: ${toInsert.length} nuevas, ${toUpdateCategory.length} categorizadas`);
      }
      return merged;
    } catch (err) {
      console.error('Error sincronizando catálogo:', err);
      if (notify) showToast('Revisa que hayas añadido la columna categoria en Supabase');
      return existingList;
    } finally {
      setSyncing(false);
    }
  };

  // Cargar datos iniciales (Supabase o LocalStorage)
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      if (isSupabaseConfigured) {
        try {
          const { data: dbRecipes, error: recErr } = await supabase
            .from('recetas')
            .select('*')
            .order('nombre');
          if (!recErr && dbRecipes) {
            if (dbRecipes.length === 0) {
              await supabase.from('recetas').insert(INITIAL_RECIPES);
              setRecipes(INITIAL_RECIPES);
            } else {
              await syncCatalogWithDatabase(dbRecipes, false);
            }
          }
          const { data: dbDiets } = await supabase.from('dietas_semanales').select('*');
          if (dbDiets && dbDiets.length > 0) {
            setWeeklyDiets(dbDiets);
            setCurrentDietId(dbDiets[0].id);
            setDietName(dbDiets[0].nombre);
            setPlan(dbDiets[0].plan);
          }
        } catch (e) {
          console.error('Error cargando Supabase:', e);
        }
      } else {
        const savedRec = localStorage.getItem('nutriplan_recetas');
        if (savedRec) {
          await syncCatalogWithDatabase(JSON.parse(savedRec), false);
        } else {
          setRecipes(INITIAL_RECIPES);
          localStorage.setItem('nutriplan_recetas', JSON.stringify(INITIAL_RECIPES));
        }
        const savedDiets = localStorage.getItem('nutriplan_dietas');
        if (savedDiets) {
          const parsed = JSON.parse(savedDiets);
          if (parsed.length > 0) {
            setWeeklyDiets(parsed);
            setCurrentDietId(parsed[0].id);
            setDietName(parsed[0].nombre);
            setPlan(parsed[0].plan);
          }
        }
      }
      setLoading(false);
    }
    loadData();
  }, []);

  // Guardar nueva receta
  const handleCreateRecipe = async (e) => {
    e.preventDefault();
    if (!newRecipe.nombre.trim()) return;
    const item = {
      id: 'rec-' + Date.now(),
      nombre: newRecipe.nombre.trim(),
      origen: newRecipe.origen || 'Personalizada',
      categoria: newRecipe.categoria || 'General',
      ingredientes: newRecipe.ingredientes.trim(),
      preparacion: newRecipe.preparacion.trim(),
      porcion_g: Number(newRecipe.porcion_g) || 0,
      kcal: Number(newRecipe.kcal) || 0,
      proteina: Number(newRecipe.proteina) || 0,
      hidratos: Number(newRecipe.hidratos) || 0,
      azucares: Number(newRecipe.azucares) || 0,
      grasas: Number(newRecipe.grasas) || 0,
      grasas_sat: Number(newRecipe.grasas_sat) || 0,
      fibra: Number(newRecipe.fibra) || 0,
      sodio: Number(newRecipe.sodio) || 0,
    };

    const updated = [item, ...recipes];
    setRecipes(updated);

    if (isSupabaseConfigured) {
      await supabase.from('recetas').insert([item]);
    } else {
      localStorage.setItem('nutriplan_recetas', JSON.stringify(updated));
    }

    setNewRecipe({
      nombre: '', origen: 'Personalizada', categoria: 'Comida / Cena (Plato Principal)',
      ingredientes: '', preparacion: '',
      porcion_g: '', kcal: '', proteina: '', hidratos: '', azucares: '',
      grasas: '', grasas_sat: '', fibra: '', sodio: ''
    });
    showToast('Receta guardada correctamente');
    setActiveTab('recetario');
  };

  const handleDeleteRecipe = async (id) => {
    const updated = recipes.filter(r => r.id !== id);
    setRecipes(updated);
    if (isSupabaseConfigured) {
      await supabase.from('recetas').delete().eq('id', id);
    } else {
      localStorage.setItem('nutriplan_recetas', JSON.stringify(updated));
    }
    showToast('Receta eliminada');
  };

  // Añadir/quitar receta del plan semanal
  const addRecipeToSlot = (dia, ingesta, recipeId) => {
    setPlan(prev => ({
      ...prev,
      [dia]: {
        ...prev[dia],
        [ingesta]: [...(prev[dia]?.[ingesta] || []), recipeId]
      }
    }));
    setPickerTarget(null);
    setPickerSearch('');
  };

  const removeRecipeFromSlot = (dia, ingesta, index) => {
    setPlan(prev => {
      const list = [...(prev[dia]?.[ingesta] || [])];
      list.splice(index, 1);
      return {
        ...prev,
        [dia]: { ...prev[dia], [ingesta]: list }
      };
    });
  };

  // Guardar dieta semanal
  const handleSaveDiet = async () => {
    const dietObj = {
      id: currentDietId,
      nombre: dietName || 'Dieta Semanal',
      plan,
      updated_at: new Date().toISOString()
    };

    const exists = weeklyDiets.some(d => d.id === currentDietId);
    const updatedDiets = exists
      ? weeklyDiets.map(d => (d.id === currentDietId ? dietObj : d))
      : [...weeklyDiets, dietObj];

    setWeeklyDiets(updatedDiets);

    if (isSupabaseConfigured) {
      await supabase.from('dietas_semanales').upsert([dietObj]);
    } else {
      localStorage.setItem('nutriplan_dietas', JSON.stringify(updatedDiets));
    }
    showToast('Dieta semanal guardada en la base de datos');
  };

  const handleNewDiet = () => {
    const newId = 'dieta-' + Date.now();
    setCurrentDietId(newId);
    setDietName(`Nueva Dieta (${weeklyDiets.length + 1})`);
    setPlan(createEmptyPlan());
    showToast('Lienzo listo para nueva dieta semanal');
  };

  const handleDeleteDiet = async () => {
    const isSaved = weeklyDiets.some(d => d.id === currentDietId);
    if (!isSaved) {
      setPlan(createEmptyPlan());
      showToast('Menú vaciado');
      return;
    }

    if (!window.confirm(`¿Seguro que quieres eliminar la dieta "${dietName}"?`)) return;

    const updatedDiets = weeklyDiets.filter(d => d.id !== currentDietId);
    setWeeklyDiets(updatedDiets);

    if (isSupabaseConfigured) {
      await supabase.from('dietas_semanales').delete().eq('id', currentDietId);
    } else {
      localStorage.setItem('nutriplan_dietas', JSON.stringify(updatedDiets));
    }

    if (updatedDiets.length > 0) {
      setCurrentDietId(updatedDiets[0].id);
      setDietName(updatedDiets[0].nombre);
      setPlan(updatedDiets[0].plan);
    } else {
      setCurrentDietId('dieta-' + Date.now());
      setDietName('Dieta Semanal Principal');
      setPlan(createEmptyPlan());
    }

    showToast('Dieta semanal eliminada');
  };

  // Autogenerar dieta rápida respetando la categoría de la ingesta si existe
  const handleAutoFillWeek = () => {
    if (recipes.length === 0) return;
    const generated = createEmptyPlan();
    DIAS.forEach(dia => {
      INGESTAS.forEach(ing => {
        const isLightMeal = ing === 'Desayuno' || ing === 'Media Mañana' || ing === 'Merienda';
        const matchingPool = recipes.filter(r => {
          const cat = (r.categoria || '').toLowerCase();
          return isLightMeal
            ? cat.includes('desayuno') || cat.includes('merienda') || cat.includes('postre')
            : cat.includes('comida') || cat.includes('cena');
        });
        const pool = matchingPool.length > 0 ? matchingPool : recipes;
        const randomRec = pool[Math.floor(Math.random() * pool.length)];
        generated[dia][ing] = [randomRec.id];
      });
    });
    setPlan(generated);
    showToast('Menú semanal autogenerado por tipo de ingesta');
  };

  // Mapa rápido id -> receta
  const recipeMap = useMemo(() => {
    const map = {};
    recipes.forEach(r => { map[r.id] = r; });
    return map;
  }, [recipes]);

  // Cálculo nutricional diario
  const dailyTotals = useMemo(() => {
    const totals = {};
    DIAS.forEach(dia => {
      const acc = {
        porcion_g: 0, kcal: 0, proteina: 0, hidratos: 0,
        azucares: 0, grasas: 0, grasas_sat: 0, fibra: 0, sodio: 0
      };
      INGESTAS.forEach(ing => {
        const ids = plan[dia]?.[ing] || [];
        ids.forEach(id => {
          const r = recipeMap[id];
          if (r) {
            acc.porcion_g += Number(r.porcion_g || 0);
            acc.kcal += Number(r.kcal || 0);
            acc.proteina += Number(r.proteina || 0);
            acc.hidratos += Number(r.hidratos || 0);
            acc.azucares += Number(r.azucares || 0);
            acc.grasas += Number(r.grasas || 0);
            acc.grasas_sat += Number(r.grasas_sat || 0);
            acc.fibra += Number(r.fibra || 0);
            acc.sodio += Number(r.sodio || 0);
          }
        });
      });
      totals[dia] = acc;
    });
    return totals;
  }, [plan, recipeMap]);

  const weeklyAverage = useMemo(() => {
    const sum = { kcal: 0, proteina: 0, hidratos: 0, grasas: 0, fibra: 0, sodio: 0 };
    DIAS.forEach(d => {
      sum.kcal += dailyTotals[d].kcal;
      sum.proteina += dailyTotals[d].proteina;
      sum.hidratos += dailyTotals[d].hidratos;
      sum.grasas += dailyTotals[d].grasas;
      sum.fibra += dailyTotals[d].fibra;
      sum.sodio += dailyTotals[d].sodio;
    });
    return {
      kcal: Math.round(sum.kcal / 7),
      proteina: Math.round(sum.proteina / 7),
      hidratos: Math.round(sum.hidratos / 7),
      grasas: Math.round(sum.grasas / 7),
      fibra: Math.round(sum.fibra / 7),
      sodio: Math.round(sum.sodio / 7),
    };
  }, [dailyTotals]);

  const filteredRecipes = recipes.filter(r => {
    const matchesText = r.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        r.ingredientes.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesOrigin = originFilter === 'Todas' || r.origen === originFilter;
    const matchesCategory = categoryFilter === 'Todas' || (r.categoria || 'General') === categoryFilter;
    return matchesText && matchesOrigin && matchesCategory;
  });

  const origins = ['Todas', ...Array.from(new Set(recipes.map(r => r.origen).filter(Boolean)))];
  const categories = ['Todas', ...Array.from(new Set(recipes.map(r => r.categoria || 'General')))];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-emerald-700 text-white shadow-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-white/15 p-2 rounded-xl">
              <Utensils className="w-6 h-6 text-emerald-100" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">NutriPlan Pro</h1>
              <p className="text-xs text-emerald-100 flex items-center gap-1">
                {isSupabaseConfigured ? (
                  <><Database className="w-3 h-3" /> Conectado a Supabase (Nube)</>
                ) : (
                  <><HardDrive className="w-3 h-3" /> Modo Local (Configura Supabase para nube)</>
                )}
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1.5 bg-emerald-800/60 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('planificador')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'planificador' ? 'bg-white text-emerald-800 shadow' : 'text-emerald-100 hover:bg-emerald-700/50'
              }`}
            >
              <Calendar className="w-4 h-4" /> Dieta Semanal
            </button>
            <button
              onClick={() => setActiveTab('recetario')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'recetario' ? 'bg-white text-emerald-800 shadow' : 'text-emerald-100 hover:bg-emerald-700/50'
              }`}
            >
              <Utensils className="w-4 h-4" /> Recetario ({recipes.length})
            </button>
            <button
              onClick={() => setActiveTab('nueva-receta')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'nueva-receta' ? 'bg-white text-emerald-800 shadow' : 'text-emerald-100 hover:bg-emerald-700/50'
              }`}
            >
              <Plus className="w-4 h-4" /> Nueva Receta
            </button>
          </nav>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          {toast}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-20 text-slate-500">Cargando recetario y datos nutricionales...</div>
        ) : (
          <>
            {/* PESTAÑA 1: PLANIFICADOR DE DIETA SEMANAL */}
            {activeTab === 'planificador' && (
              <div className="space-y-6">
                {/* Barra de controles de dieta */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
                    <input
                      type="text"
                      value={dietName}
                      onChange={(e) => setDietName(e.target.value)}
                      placeholder="Nombre de la dieta semanal..."
                      className="font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    {weeklyDiets.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={currentDietId}
                          onChange={(e) => {
                            const found = weeklyDiets.find(d => d.id === e.target.value);
                            if (found) {
                              setCurrentDietId(found.id);
                              setDietName(found.nombre);
                              setPlan(found.plan);
                            }
                          }}
                          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm"
                        >
                          {weeklyDiets.map(d => (
                            <option key={d.id} value={d.id}>{d.nombre}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleDeleteDiet}
                          title="Eliminar dieta seleccionada"
                          className="p-2 rounded-xl text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleAutoFillWeek}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition"
                    >
                      <Sparkles className="w-4 h-4" /> Autogenerar Menú
                    </button>
                    <button
                      onClick={handleNewDiet}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                    >
                      <Copy className="w-4 h-4" /> Nueva Semana
                    </button>
                    <button
                      onClick={handleSaveDiet}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition"
                    >
                      <Save className="w-4 h-4" /> Guardar Dieta
                    </button>
                  </div>
                </div>

                {/* Resumen promedio semanal */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500 flex items-center gap-1"><Flame className="w-3.5 h-3.5 text-orange-500" /> Media Energía</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{weeklyAverage.kcal} <span className="text-xs font-normal text-slate-500">kcal/día</span></div>
                  </div>
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500 flex items-center gap-1"><Drumstick className="w-3.5 h-3.5 text-rose-500" /> Media Proteína</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{weeklyAverage.proteina} <span className="text-xs font-normal text-slate-500">g/día</span></div>
                  </div>
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500 flex items-center gap-1"><Wheat className="w-3.5 h-3.5 text-amber-500" /> Media Hidratos</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{weeklyAverage.hidratos} <span className="text-xs font-normal text-slate-500">g/día</span></div>
                  </div>
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500 flex items-center gap-1"><Droplet className="w-3.5 h-3.5 text-yellow-500" /> Media Grasas</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{weeklyAverage.grasas} <span className="text-xs font-normal text-slate-500">g/día</span></div>
                  </div>
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500">Media Fibra</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{weeklyAverage.fibra} <span className="text-xs font-normal text-slate-500">g/día</span></div>
                  </div>
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500">Media Sodio</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{weeklyAverage.sodio} <span className="text-xs font-normal text-slate-500">mg/día</span></div>
                  </div>
                </div>

                {/* Cuadrícula de 7 días con totales nutricionales por día */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-4">
                  {DIAS.map(dia => {
                    const tot = dailyTotals[dia];
                    return (
                      <div key={dia} className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                        <div className="bg-slate-800 text-white px-3.5 py-2.5 flex items-center justify-between">
                          <span className="font-bold text-sm">{dia}</span>
                          <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-semibold">
                            {Math.round(tot.kcal)} kcal
                          </span>
                        </div>

                        {/* Ingestas del día */}
                        <div className="p-2.5 space-y-2.5 flex-1">
                          {INGESTAS.map(ing => {
                            const items = plan[dia]?.[ing] || [];
                            return (
                              <div key={ing} className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{ing}</span>
                                  <button
                                    onClick={() => {
                                      setPickerCategory('Todas');
                                      setPickerTarget({ dia, ingesta: ing });
                                    }}
                                    className="text-emerald-600 hover:bg-emerald-100 p-1 rounded-md transition"
                                    title="Añadir receta"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                {items.length === 0 ? (
                                  <div className="text-[11px] text-slate-400 italic py-1">Sin asignar</div>
                                ) : (
                                  <div className="space-y-1">
                                    {items.map((recId, idx) => {
                                      const r = recipeMap[recId];
                                      if (!r) return null;
                                      return (
                                        <div key={idx} className="bg-white border border-slate-200 rounded-lg p-1.5 text-xs shadow-2xs group relative">
                                          <div
                                            onClick={() => setSelectedRecipeModal(r)}
                                            className="font-medium text-slate-700 pr-4 cursor-pointer hover:text-emerald-700 line-clamp-2"
                                          >
                                            {r.nombre}
                                          </div>
                                          <div className="text-[10px] text-slate-400 mt-0.5">
                                            {r.kcal} kcal · {r.proteina}g P · {r.hidratos}g HC · {r.grasas}g G
                                          </div>
                                          <button
                                            onClick={() => removeRecipeFromSlot(dia, ing, idx)}
                                            className="absolute top-1.5 right-1 text-slate-300 hover:text-rose-500"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Balance nutricional completo del día */}
                        <div className="bg-emerald-50/80 border-t border-emerald-100 p-3 text-xs space-y-1">
                          <div className="font-bold text-emerald-900 mb-1">Total {dia}</div>
                          <div className="flex justify-between"><span className="text-slate-600">Energía:</span> <span className="font-bold">{Math.round(tot.kcal)} kcal</span></div>
                          <div className="flex justify-between"><span className="text-slate-600">Proteínas:</span> <span className="font-semibold text-rose-700">{tot.proteina.toFixed(1)} g</span></div>
                          <div className="flex justify-between"><span className="text-slate-600">Hidratos:</span> <span className="font-semibold text-amber-700">{tot.hidratos.toFixed(1)} g</span></div>
                          <div className="flex justify-between text-[11px] text-slate-500 pl-2"><span>↳ Azúcares:</span> <span>{tot.azucares.toFixed(1)} g</span></div>
                          <div className="flex justify-between"><span className="text-slate-600">Grasas:</span> <span className="font-semibold text-yellow-700">{tot.grasas.toFixed(1)} g</span></div>
                          <div className="flex justify-between text-[11px] text-slate-500 pl-2"><span>↳ Saturadas:</span> <span>{tot.grasas_sat.toFixed(1)} g</span></div>
                          <div className="flex justify-between"><span className="text-slate-600">Fibra:</span> <span className="font-medium">{tot.fibra.toFixed(1)} g</span></div>
                          <div className="flex justify-between"><span className="text-slate-600">Sodio:</span> <span className="font-medium">{Math.round(tot.sodio)} mg</span></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* PESTAÑA 2: RECETARIO Y FICHAS */}
            {activeTab === 'recetario' && (
              <div className="space-y-5">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                  <div className="flex flex-wrap gap-3 items-center justify-between">
                    <div className="relative flex-1 min-w-[240px]">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        placeholder="Buscar por nombre de receta o ingrediente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        {categories.map(cat => (
                          <option key={cat} value={cat}>
                            {cat === 'Todas' ? 'Todas las categorías' : cat}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => syncCatalogWithDatabase(recipes, true)}
                        disabled={syncing}
                        title="Importar recetas nuevas del Excel y actualizar categorías"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                        Sincronizar Excel
                      </button>
                    </div>
                  </div>

                  {/* Filtro rápido por Dieta de Origen */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs text-slate-400 mr-1">Origen:</span>
                    {origins.map(orig => (
                      <button
                        key={orig}
                        onClick={() => setOriginFilter(orig)}
                        className={`px-3 py-1 rounded-xl text-xs font-medium transition ${
                          originFilter === orig ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {orig}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredRecipes.map(rec => (
                    <div key={rec.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col justify-between hover:border-emerald-300 transition">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-slate-800 text-base leading-snug">{rec.nombre}</h3>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0 font-medium">
                            {rec.origen}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-medium border border-emerald-100">
                            <Tag className="w-3 h-3" /> {rec.categoria || 'General'}
                          </span>
                          <span className="text-xs text-slate-500">Porción: {rec.porcion_g} g</span>
                        </div>

                        {/* Badges nutricionales */}
                        <div className="grid grid-cols-4 gap-1.5 my-3 text-center">
                          <div className="bg-orange-50 rounded-lg p-1.5">
                            <div className="text-[10px] text-orange-600 font-medium">Energía</div>
                            <div className="text-xs font-bold text-slate-800">{rec.kcal} kcal</div>
                          </div>
                          <div className="bg-rose-50 rounded-lg p-1.5">
                            <div className="text-[10px] text-rose-600 font-medium">Proteína</div>
                            <div className="text-xs font-bold text-slate-800">{rec.proteina} g</div>
                          </div>
                          <div className="bg-amber-50 rounded-lg p-1.5">
                            <div className="text-[10px] text-amber-600 font-medium">Hidratos</div>
                            <div className="text-xs font-bold text-slate-800">{rec.hidratos} g</div>
                          </div>
                          <div className="bg-yellow-50 rounded-lg p-1.5">
                            <div className="text-[10px] text-yellow-700 font-medium">Grasas</div>
                            <div className="text-xs font-bold text-slate-800">{rec.grasas} g</div>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 line-clamp-3 whitespace-pre-line bg-slate-50 p-2.5 rounded-xl">
                          {rec.ingredientes}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                        <button
                          onClick={() => setSelectedRecipeModal(rec)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                          <Eye className="w-4 h-4" /> Ver Ficha Completa
                        </button>
                        <button
                          onClick={() => handleDeleteRecipe(rec.id)}
                          className="text-slate-400 hover:text-rose-600 p-1 transition"
                          title="Eliminar receta"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PESTAÑA 3: CREAR NUEVA RECETA */}
            {activeTab === 'nueva-receta' && (
              <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-xl font-bold text-slate-800 mb-1">Añadir Nueva Receta</h2>
                <p className="text-sm text-slate-500 mb-6">Completa los datos, categoría y valores nutricionales para incorporarla a tu base de datos.</p>

                <form onSubmit={handleCreateRecipe} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre de la Receta *</label>
                      <input
                        required
                        type="text"
                        value={newRecipe.nombre}
                        onChange={e => setNewRecipe({ ...newRecipe, nombre: e.target.value })}
                        placeholder="Ej. Salmón al horno con espárragos"
                        className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo de Ingesta / Categoría *</label>
                      <input
                        required
                        list="categorias-list"
                        type="text"
                        value={newRecipe.categoria}
                        onChange={e => setNewRecipe({ ...newRecipe, categoria: e.target.value })}
                        placeholder="Selecciona o escribe una categoría..."
                        className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm"
                      />
                      <datalist id="categorias-list">
                        {CATEGORIAS_SUGERIDAS.map(cat => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Dieta de Origen / Etiqueta</label>
                      <input
                        type="text"
                        value={newRecipe.origen}
                        onChange={e => setNewRecipe({ ...newRecipe, origen: e.target.value })}
                        placeholder="Ej. Dieta 3 o Personalizada"
                        className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Ingredientes y Cantidades *</label>
                      <textarea
                        required
                        rows={5}
                        value={newRecipe.ingredientes}
                        onChange={e => setNewRecipe({ ...newRecipe, ingredientes: e.target.value })}
                        placeholder="• 180 g de salmón fresco&#10;• 150 g de espárragos verdes&#10;• 1 cda de AOVE (9 g)"
                        className="w-full border border-slate-300 rounded-xl p-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Método de Preparación *</label>
                      <textarea
                        required
                        rows={5}
                        value={newRecipe.preparacion}
                        onChange={e => setNewRecipe({ ...newRecipe, preparacion: e.target.value })}
                        placeholder="1º Precalentar el horno a 200°C.&#10;2º Colocar el salmón y los espárragos..."
                        className="w-full border border-slate-300 rounded-xl p-3 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-slate-800 mb-3 border-b pb-1">Información Nutricional por Porción</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        { key: 'porcion_g', label: 'Porción (g)' },
                        { key: 'kcal', label: 'Energía (kcal)' },
                        { key: 'proteina', label: 'Proteína (g)' },
                        { key: 'hidratos', label: 'Hidratos (g)' },
                        { key: 'azucares', label: 'Azúcares (g)' },
                        { key: 'grasas', label: 'Grasas (g)' },
                        { key: 'grasas_sat', label: 'Grasa Sat. (g)' },
                        { key: 'fibra', label: 'Fibra (g)' },
                        { key: 'sodio', label: 'Sodio (mg)' },
                      ].map(field => (
                        <div key={field.key}>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">{field.label}</label>
                          <input
                            type="number"
                            step="0.1"
                            value={newRecipe[field.key]}
                            onChange={e => setNewRecipe({ ...newRecipe, [field.key]: e.target.value })}
                            placeholder="0"
                            className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('recetario')}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                    >
                      Guardar Receta
                    </button>
                  </div>
                </form>
              </div>
            )}
          </>
        )}
      </main>

      {/* MODAL: DETALLE COMPLETO DE RECETA */}
      {selectedRecipeModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">
                    {selectedRecipeModal.origen}
                  </span>
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    {selectedRecipeModal.categoria || 'General'}
                  </span>
                  <span className="text-xs text-slate-500">
                    · Porción: {selectedRecipeModal.porcion_g} g
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-800 mt-1.5">{selectedRecipeModal.nombre}</h2>
              </div>
              <button onClick={() => setSelectedRecipeModal(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div><div className="text-[11px] text-slate-500">Energía</div><div className="font-bold text-sm">{selectedRecipeModal.kcal} kcal</div></div>
              <div><div className="text-[11px] text-slate-500">Proteína</div><div className="font-bold text-sm text-rose-600">{selectedRecipeModal.proteina} g</div></div>
              <div><div className="text-[11px] text-slate-500">Hidratos</div><div className="font-bold text-sm text-amber-600">{selectedRecipeModal.hidratos} g</div></div>
              <div><div className="text-[11px] text-slate-500">Grasas</div><div className="font-bold text-sm text-yellow-700">{selectedRecipeModal.grasas} g</div></div>
              <div><div className="text-[11px] text-slate-500">Azúcares</div><div className="font-semibold text-xs">{selectedRecipeModal.azucares} g</div></div>
              <div><div className="text-[11px] text-slate-500">Grasa Sat.</div><div className="font-semibold text-xs">{selectedRecipeModal.grasas_sat} g</div></div>
              <div><div className="text-[11px] text-slate-500">Fibra</div><div className="font-semibold text-xs">{selectedRecipeModal.fibra} g</div></div>
              <div><div className="text-[11px] text-slate-500">Sodio</div><div className="font-semibold text-xs">{selectedRecipeModal.sodio} mg</div></div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Ingredientes y Cantidades</h4>
              <div className="bg-slate-50 p-3.5 rounded-xl text-sm text-slate-700 whitespace-pre-line border border-slate-100">
                {selectedRecipeModal.ingredientes}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Método de Preparación</h4>
              <div className="bg-emerald-50/50 p-3.5 rounded-xl text-sm text-slate-700 whitespace-pre-line border border-emerald-100">
                {selectedRecipeModal.preparacion}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SELECTOR DE RECETA PARA EL PLAN SEMANAL */}
      {pickerTarget && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-800">Añadir a {pickerTarget.dia}</h3>
                <p className="text-xs text-slate-500">Ingesta: {pickerTarget.ingesta}</p>
              </div>
              <button onClick={() => setPickerTarget(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 border-b space-y-2">
              <input
                type="text"
                autoFocus
                placeholder="Filtrar receta por nombre..."
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
              <select
                value={pickerCategory}
                onChange={e => setPickerCategory(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat === 'Todas' ? 'Todas las categorías' : cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-y-auto p-3 space-y-1.5 flex-1">
              {recipes
                .filter(r => {
                  const matchText = r.nombre.toLowerCase().includes(pickerSearch.toLowerCase());
                  const matchCat = pickerCategory === 'Todas' || (r.categoria || 'General') === pickerCategory;
                  return matchText && matchCat;
                })
                .map(r => (
                  <button
                    key={r.id}
                    onClick={() => addRecipeToSlot(pickerTarget.dia, pickerTarget.ingesta, r.id)}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold text-sm text-slate-800">{r.nombre}</div>
                      <div className="text-[11px] text-emerald-700 font-medium">{r.categoria || 'General'} · {r.origen}</div>
                      <div className="text-xs text-slate-500">{r.porcion_g}g · {r.proteina}g P · {r.hidratos}g HC · {r.grasas}g G</div>
                    </div>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-lg shrink-0">
                      {r.kcal} kcal
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
