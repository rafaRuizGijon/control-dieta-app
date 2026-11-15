import React, { useState, useEffect, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { INITIAL_RECIPES } from './initialRecipes';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import {
  Utensils, Calendar, Plus, Search, Trash2, Eye, X, CheckCircle2,
  Database, Flame, Drumstick, Wheat, Droplet, Sparkles, Save, Copy, Tag,
  Pencil, FileDown, Users, LogOut, ShieldCheck, Clock, Lock, Mail, UserPlus, LogIn
} from 'lucide-react';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const INGESTAS = ['Desayuno', 'Media Mañana', 'Comida', 'Merienda', 'Cena'];
const INGESTAS_DOBLES = ['Comida', 'Cena'];

const CATEGORIAS_SUGERIDAS = [
  'Comida / Cena (Plato Principal)',
  'Comida / Cena (Entrante / Guarnición)',
  'Comida / Cena',
  'Desayuno / Merienda',
  'Postre / Merienda'
];

const EMPTY_RECIPE_FORM = {
  nombre: '', origen: 'Personalizada', categoria: 'Comida / Cena (Plato Principal)',
  ingredientes: '', preparacion: '',
  porcion_g: '', kcal: '', proteina: '', hidratos: '', azucares: '',
  grasas: '', grasas_sat: '', fibra: '', sodio: ''
};

const createEmptyPlan = () => {
  const plan = {};
  DIAS.forEach(dia => {
    plan[dia] = {};
    INGESTAS.forEach(ing => {
      plan[dia][ing] = INGESTAS_DOBLES.includes(ing)
        ? { primeros: [], segundos: [] }
        : [];
    });
  });
  return plan;
};

// Normaliza cualquier plan cargado (soporta tanto arrays simples como { primeros, segundos })
const normalizeLoadedPlan = (rawPlan) => {
  const base = createEmptyPlan();
  if (!rawPlan || typeof rawPlan !== 'object') return base;

  DIAS.forEach(dia => {
    INGESTAS.forEach(ing => {
      const val = rawPlan[dia]?.[ing];
      if (INGESTAS_DOBLES.includes(ing)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          base[dia][ing] = {
            primeros: Array.isArray(val.primeros) ? val.primeros : [],
            segundos: Array.isArray(val.segundos) ? val.segundos : []
          };
        } else if (Array.isArray(val)) {
          base[dia][ing] = { primeros: val, segundos: [] };
        }
      } else {
        base[dia][ing] = Array.isArray(val) ? val : [];
      }
    });
  });

  return base;
};

const normalizeName = (str) => (str || '').trim().toLowerCase();

// Envío de notificación a rafaelalon@gmail.com vía EmailJS REST API
const notifyAdminByEmail = async ({ userName, userEmail }) => {
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

  if (!serviceId || !templateId || !publicKey) return;

  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_email: 'rafaelalon@gmail.com',
          user_name: userName || userEmail,
          user_email: userEmail,
          app_url: window.location.origin
        }
      })
    });
  } catch (err) {
    console.error('Error enviando notificación EmailJS:', err);
  }
};

export default function App() {
  // Estados de autenticación y perfil
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [authNombre, setAuthNombre] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authMessage, setAuthMessage] = useState(null);

  // Estados de la aplicación
  const [activeTab, setActiveTab] = useState('planificador');
  const [recipes, setRecipes] = useState([]);
  const [weeklyDiets, setWeeklyDiets] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [currentDietId, setCurrentDietId] = useState('dieta-actual');
  const [dietName, setDietName] = useState('Dieta Semanal Principal');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [plan, setPlan] = useState(createEmptyPlan());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Filtros y modales
  const [searchTerm, setSearchTerm] = useState('');
  const [originFilter, setOriginFilter] = useState('Todas');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [selectedRecipeModal, setSelectedRecipeModal] = useState(null);
  // pickerTarget: { dia, ingesta, tipoPlato?: 'primeros' | 'segundos' }
  const [pickerTarget, setPickerTarget] = useState(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState('Todas');

  // Formulario nueva / editar receta
  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [newRecipe, setNewRecipe] = useState(EMPTY_RECIPE_FORM);

  const isAdmin = userProfile?.rol === 'admin' && userProfile?.aprobado === true;
  const isApprovedUser = userProfile?.aprobado === true;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Cargar perfil del usuario autenticado
  const fetchUserProfile = async (user) => {
    if (!user || !isSupabaseConfigured) {
      setUserProfile(null);
      return null;
    }
    const { data, error } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!error && data) {
      setUserProfile(data);
      return data;
    }

    const isOwner = (user.email || '').toLowerCase() === 'rafaelalon@gmail.com';
    const fallbackProfile = {
      id: user.id,
      email: user.email,
      nombre: user.user_metadata?.nombre || user.email.split('@')[0],
      rol: isOwner ? 'admin' : 'usuario',
      aprobado: isOwner
    };
    await supabase.from('perfiles').upsert([fallbackProfile]);
    setUserProfile(fallbackProfile);
    return fallbackProfile;
  };

  // Suscripción a sesión de Supabase Auth
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user) {
        await fetchUserProfile(currentSession.user);
      }
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        await fetchUserProfile(newSession.user);
      } else {
        setUserProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Sincronización silenciosa inicial con INITIAL_RECIPES (solo admin)
  const syncCatalogSilently = async (existingList) => {
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

      if (toInsert.length > 0) {
        const { error } = await supabase.from('recetas').insert(toInsert);
        if (!error) merged = [...merged, ...toInsert];
      }
      for (const item of toUpdateCategory) {
        await supabase.from('recetas').update({ categoria: item.categoria }).eq('id', item.id);
      }

      if (toUpdateCategory.length > 0) {
        const catMap = new Map(toUpdateCategory.map(u => [u.id, u.categoria]));
        merged = merged.map(r => (catMap.has(r.id) ? { ...r, categoria: catMap.get(r.id) } : r));
      }

      setRecipes(merged);
    } catch (err) {
      console.error('Error sincronizando catálogo inicial:', err);
      setRecipes(existingList);
    }
  };

  // Cargar datos cuando el usuario está aprobado
  useEffect(() => {
    if (!isSupabaseConfigured || !session?.user || !isApprovedUser) return;

    async function loadAuthorizedData() {
      setLoading(true);
      try {
        // 1. Cargar recetas
        const { data: dbRecipes, error: recErr } = await supabase
          .from('recetas')
          .select('*')
          .order('nombre');

        if (!recErr && dbRecipes) {
          if (dbRecipes.length === 0 && isAdmin) {
            await supabase.from('recetas').insert(INITIAL_RECIPES);
            setRecipes(INITIAL_RECIPES);
          } else if (isAdmin) {
            await syncCatalogSilently(dbRecipes);
          } else {
            setRecipes(dbRecipes);
          }
        }

        // 2. Cargar dietas con filtro estricto por usuario_id si no es admin
        let dietsQuery = supabase
          .from('dietas_semanales')
          .select('*')
          .order('updated_at', { ascending: false });

        if (!isAdmin) {
          dietsQuery = dietsQuery.eq('usuario_id', session.user.id);
        }

        const { data: dbDiets } = await dietsQuery;

        if (dbDiets && dbDiets.length > 0) {
          const normalizedDiets = dbDiets.map(d => ({
            ...d,
            plan: normalizeLoadedPlan(d.plan)
          }));
          setWeeklyDiets(normalizedDiets);
          setCurrentDietId(normalizedDiets[0].id);
          setDietName(normalizedDiets[0].nombre);
          setAssignedUserId(normalizedDiets[0].usuario_id || '');
          setPlan(normalizedDiets[0].plan);
        } else {
          setWeeklyDiets([]);
          setCurrentDietId('dieta-' + Date.now());
          setDietName('Dieta Semanal Principal');
          setAssignedUserId('');
          setPlan(createEmptyPlan());
        }

        // 3. Si es admin, cargar listado de usuarios para asignar dietas y aprobar altas
        if (isAdmin) {
          const { data: profilesData } = await supabase
            .from('perfiles')
            .select('*')
            .order('created_at', { ascending: false });
          if (profilesData) setAllUsers(profilesData);
        }
      } catch (e) {
        console.error('Error cargando datos:', e);
      }
      setLoading(false);
    }

    loadAuthorizedData();
  }, [session, isApprovedUser, isAdmin]);

  // Handlers de Autenticación
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthSubmitting(true);
    setAuthMessage(null);

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword
        });
        if (error) throw error;
      } else {
        const cleanEmail = authEmail.trim();
        const cleanName = authNombre.trim() || cleanEmail.split('@')[0];

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: authPassword,
          options: {
            data: { nombre: cleanName }
          }
        });
        if (error) throw error;

        if (cleanEmail.toLowerCase() !== 'rafaelalon@gmail.com') {
          await notifyAdminByEmail({ userName: cleanName, userEmail: cleanEmail });
          setAuthMessage({
            type: 'success',
            text: 'Solicitud enviada. Se ha notificado al administrador (rafaelalon@gmail.com). Podrás acceder en cuanto apruebe tu cuenta.'
          });
        } else {
          setAuthMessage({
            type: 'success',
            text: 'Cuenta de administrador creada. Iniciando sesión...'
          });
        }

        if (!data.session) {
          setAuthMode('login');
        }
      }
    } catch (err) {
      setAuthMessage({
        type: 'error',
        text: err.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : err.message
      });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUserProfile(null);
    setActiveTab('planificador');
  };

  // Gestión de usuarios (Solo Admin)
  const handleToggleApproveUser = async (targetUser) => {
    if (targetUser.email.toLowerCase() === 'rafaelalon@gmail.com') return;
    const newApproved = !targetUser.aprobado;
    const { error } = await supabase
      .from('perfiles')
      .update({ aprobado: newApproved })
      .eq('id', targetUser.id);

    if (!error) {
      setAllUsers(prev => prev.map(u => (u.id === targetUser.id ? { ...u, aprobado: newApproved } : u)));
      showToast(newApproved ? `Acceso aprobado para ${targetUser.email}` : `Acceso revocado para ${targetUser.email}`);
    }
  };

  const handleChangeUserRole = async (targetUser, newRole) => {
    if (targetUser.email.toLowerCase() === 'rafaelalon@gmail.com') return;
    const { error } = await supabase
      .from('perfiles')
      .update({ rol: newRole })
      .eq('id', targetUser.id);

    if (!error) {
      setAllUsers(prev => prev.map(u => (u.id === targetUser.id ? { ...u, rol: newRole } : u)));
      showToast(`Rol actualizado a ${newRole === 'admin' ? 'Administrador' : 'Usuario Estándar'}`);
    }
  };

  const handleDeleteUserProfile = async (targetUser) => {
    if (targetUser.email.toLowerCase() === 'rafaelalon@gmail.com') return;
    if (!window.confirm(`¿Eliminar el perfil de ${targetUser.email}?`)) return;
    const { error } = await supabase
      .from('perfiles')
      .delete()
      .eq('id', targetUser.id);

    if (!error) {
      setAllUsers(prev => prev.filter(u => u.id !== targetUser.id));
      showToast('Usuario eliminado');
    }
  };

  // Abrir formulario precargado para editar receta (Solo Admin)
  const handleStartEditRecipe = (rec) => {
    if (!isAdmin) return;
    setEditingRecipeId(rec.id);
    setNewRecipe({
      nombre: rec.nombre || '',
      origen: rec.origen || 'Personalizada',
      categoria: rec.categoria || 'General',
      ingredientes: rec.ingredientes || '',
      preparacion: rec.preparacion || '',
      porcion_g: rec.porcion_g ?? '',
      kcal: rec.kcal ?? '',
      proteina: rec.proteina ?? '',
      hidratos: rec.hidratos ?? '',
      azucares: rec.azucares ?? '',
      grasas: rec.grasas ?? '',
      grasas_sat: rec.grasas_sat ?? '',
      fibra: rec.fibra ?? '',
      sodio: rec.sodio ?? '',
    });
    setSelectedRecipeModal(null);
    setActiveTab('nueva-receta');
  };

  const handleCancelRecipeForm = () => {
    setEditingRecipeId(null);
    setNewRecipe(EMPTY_RECIPE_FORM);
    setActiveTab('recetario');
  };

  // Guardar nueva receta o actualizar existente (Solo Admin)
  const handleSaveRecipe = async (e) => {
    e.preventDefault();
    if (!isAdmin || !newRecipe.nombre.trim()) return;

    const payload = {
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

    if (editingRecipeId) {
      const updatedItem = { id: editingRecipeId, ...payload };
      const updated = recipes.map(r => (r.id === editingRecipeId ? updatedItem : r));
      setRecipes(updated);
      await supabase.from('recetas').update(payload).eq('id', editingRecipeId);

      setEditingRecipeId(null);
      setNewRecipe(EMPTY_RECIPE_FORM);
      showToast('Receta actualizada correctamente');
      setActiveTab('recetario');
    } else {
      const item = { id: 'rec-' + Date.now(), ...payload };
      const updated = [item, ...recipes];
      setRecipes(updated);
      await supabase.from('recetas').insert([item]);

      setNewRecipe(EMPTY_RECIPE_FORM);
      showToast('Receta guardada correctamente');
      setActiveTab('recetario');
    }
  };

  const handleDeleteRecipe = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm('¿Seguro que quieres eliminar esta receta del recetario?')) return;
    const updated = recipes.filter(r => r.id !== id);
    setRecipes(updated);
    await supabase.from('recetas').delete().eq('id', id);
    showToast('Receta eliminada');
  };

  // Añadir/quitar receta del plan semanal (soporta 1º y 2º plato en Comida/Cena)
  const addRecipeToSlot = (dia, ingesta, recipeId, tipoPlato = null) => {
    if (!isAdmin) return;
    setPlan(prev => {
      if (INGESTAS_DOBLES.includes(ingesta) && tipoPlato) {
        const currentDouble = prev[dia]?.[ingesta] || { primeros: [], segundos: [] };
        return {
          ...prev,
          [dia]: {
            ...prev[dia],
            [ingesta]: {
              ...currentDouble,
              [tipoPlato]: [...(currentDouble[tipoPlato] || []), recipeId]
            }
          }
        };
      }
      return {
        ...prev,
        [dia]: {
          ...prev[dia],
          [ingesta]: [...(prev[dia]?.[ingesta] || []), recipeId]
        }
      };
    });
    setPickerTarget(null);
    setPickerSearch('');
  };

  const removeRecipeFromSlot = (dia, ingesta, index, tipoPlato = null) => {
    if (!isAdmin) return;
    setPlan(prev => {
      if (INGESTAS_DOBLES.includes(ingesta) && tipoPlato) {
        const currentDouble = prev[dia]?.[ingesta] || { primeros: [], segundos: [] };
        const list = [...(currentDouble[tipoPlato] || [])];
        list.splice(index, 1);
        return {
          ...prev,
          [dia]: {
            ...prev[dia],
            [ingesta]: {
              ...currentDouble,
              [tipoPlato]: list
            }
          }
        };
      }
      const list = [...(prev[dia]?.[ingesta] || [])];
      list.splice(index, 1);
      return {
        ...prev,
        [dia]: { ...prev[dia], [ingesta]: list }
      };
    });
  };

  // Guardar dieta semanal y asignación de usuario (Solo Admin)
  const handleSaveDiet = async () => {
    if (!isAdmin) return;
    const dietObj = {
      id: currentDietId,
      nombre: dietName || 'Dieta Semanal',
      usuario_id: assignedUserId || null,
      plan,
      updated_at: new Date().toISOString()
    };

    const exists = weeklyDiets.some(d => d.id === currentDietId);
    const updatedDiets = exists
      ? weeklyDiets.map(d => (d.id === currentDietId ? dietObj : d))
      : [dietObj, ...weeklyDiets];

    setWeeklyDiets(updatedDiets);
    const { error } = await supabase.from('dietas_semanales').upsert([dietObj]);
    if (error) {
      showToast('Error al guardar la dieta: ' + error.message);
    } else {
      showToast('Dieta semanal guardada y asignada correctamente');
    }
  };

  const handleNewDiet = () => {
    if (!isAdmin) return;
    const newId = 'dieta-' + Date.now();
    setCurrentDietId(newId);
    setDietName(`Nueva Dieta (${weeklyDiets.length + 1})`);
    setAssignedUserId('');
    setPlan(createEmptyPlan());
    showToast('Lienzo listo para nueva dieta semanal');
  };

  const handleDeleteDiet = async () => {
    if (!isAdmin) return;
    const isSaved = weeklyDiets.some(d => d.id === currentDietId);
    if (!isSaved) {
      setPlan(createEmptyPlan());
      showToast('Menú vaciado');
      return;
    }

    if (!window.confirm(`¿Seguro que quieres eliminar la dieta "${dietName}"?`)) return;

    const updatedDiets = weeklyDiets.filter(d => d.id !== currentDietId);
    setWeeklyDiets(updatedDiets);
    await supabase.from('dietas_semanales').delete().eq('id', currentDietId);

    if (updatedDiets.length > 0) {
      setCurrentDietId(updatedDiets[0].id);
      setDietName(updatedDiets[0].nombre);
      setAssignedUserId(updatedDiets[0].usuario_id || '');
      setPlan(updatedDiets[0].plan);
    } else {
      setCurrentDietId('dieta-' + Date.now());
      setDietName('Dieta Semanal Principal');
      setAssignedUserId('');
      setPlan(createEmptyPlan());
    }

    showToast('Dieta semanal eliminada');
  };

  const handleAutoFillWeek = () => {
    if (!isAdmin || recipes.length === 0) return;
    const generated = createEmptyPlan();

    const entrantesPool = recipes.filter(r =>
      (r.categoria || '').toLowerCase().includes('entrante') ||
      (r.categoria || '').toLowerCase().includes('guarnición')
    );
    const principalesPool = recipes.filter(r =>
      (r.categoria || '').toLowerCase().includes('principal') ||
      ((r.categoria || '').toLowerCase().includes('comida') && !(r.categoria || '').toLowerCase().includes('entrante'))
    );
    const lightPool = recipes.filter(r => {
      const cat = (r.categoria || '').toLowerCase();
      return cat.includes('desayuno') || cat.includes('merienda') || cat.includes('postre');
    });

    const pickRandom = (arr) => {
      const source = arr.length > 0 ? arr : recipes;
      return source[Math.floor(Math.random() * source.length)].id;
    };

    DIAS.forEach(dia => {
      INGESTAS.forEach(ing => {
        if (INGESTAS_DOBLES.includes(ing)) {
          generated[dia][ing] = {
            primeros: [pickRandom(entrantesPool)],
            segundos: [pickRandom(principalesPool)]
          };
        } else {
          generated[dia][ing] = [pickRandom(lightPool)];
        }
      });
    });

    setPlan(generated);
    showToast('Menú semanal autogenerado con 1º y 2º plato');
  };

  // Mapa rápido id -> receta
  const recipeMap = useMemo(() => {
    const map = {};
    recipes.forEach(r => { map[r.id] = r; });
    return map;
  }, [recipes]);

  // Cálculo nutricional diario (promedia opciones alternativas en 1º y 2º plato)
  const dailyTotals = useMemo(() => {
    const totals = {};
    const addRecipeNutrients = (acc, r, weight = 1) => {
      if (!r) return;
      acc.porcion_g += Number(r.porcion_g || 0) * weight;
      acc.kcal += Number(r.kcal || 0) * weight;
      acc.proteina += Number(r.proteina || 0) * weight;
      acc.hidratos += Number(r.hidratos || 0) * weight;
      acc.azucares += Number(r.azucares || 0) * weight;
      acc.grasas += Number(r.grasas || 0) * weight;
      acc.grasas_sat += Number(r.grasas_sat || 0) * weight;
      acc.fibra += Number(r.fibra || 0) * weight;
      acc.sodio += Number(r.sodio || 0) * weight;
    };

    DIAS.forEach(dia => {
      const acc = {
        porcion_g: 0, kcal: 0, proteina: 0, hidratos: 0,
        azucares: 0, grasas: 0, grasas_sat: 0, fibra: 0, sodio: 0
      };
      INGESTAS.forEach(ing => {
        const slot = plan[dia]?.[ing];
        if (INGESTAS_DOBLES.includes(ing)) {
          const primeros = (slot?.primeros || []).map(id => recipeMap[id]).filter(Boolean);
          const segundos = (slot?.segundos || []).map(id => recipeMap[id]).filter(Boolean);
          if (primeros.length > 0) {
            primeros.forEach(r => addRecipeNutrients(acc, r, 1 / primeros.length));
          }
          if (segundos.length > 0) {
            segundos.forEach(r => addRecipeNutrients(acc, r, 1 / segundos.length));
          }
        } else {
          const ids = Array.isArray(slot) ? slot : [];
          ids.forEach(id => addRecipeNutrients(acc, recipeMap[id], 1));
        }
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

  // GENERAR PDF DE LA DIETA SEMANAL (Incluye todas las opciones de 1º y 2º plato)
  const handleExportDietPDF = () => {
    const usedIdsSet = new Set();
    DIAS.forEach(dia => {
      INGESTAS.forEach(ing => {
        const slot = plan[dia]?.[ing];
        if (INGESTAS_DOBLES.includes(ing)) {
          (slot?.primeros || []).forEach(id => { if (recipeMap[id]) usedIdsSet.add(id); });
          (slot?.segundos || []).forEach(id => { if (recipeMap[id]) usedIdsSet.add(id); });
        } else {
          (Array.isArray(slot) ? slot : []).forEach(id => { if (recipeMap[id]) usedIdsSet.add(id); });
        }
      });
    });

    if (usedIdsSet.size === 0) {
      showToast('No hay recetas asignadas en esta dieta para exportar');
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const title = dietName?.trim() || 'Dieta Semanal';
    const fecha = new Date().toLocaleDateString('es-ES');

    doc.setFillColor(4, 120, 87);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(title, 14, 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(
      `NutriPlan Pro · Fecha: ${fecha} · Media diaria: ${weeklyAverage.kcal} kcal | ${weeklyAverage.proteina}g Prot | ${weeklyAverage.hidratos}g HC | ${weeklyAverage.grasas}g Grasas`,
      14,
      17.5
    );

    const head = [['Ingesta', ...DIAS]];
    const body = INGESTAS.map(ing => {
      const row = [ing];
      DIAS.forEach(dia => {
        const slot = plan[dia]?.[ing];
        if (INGESTAS_DOBLES.includes(ing)) {
          const primeros = (slot?.primeros || []).map(id => recipeMap[id]).filter(Boolean);
          const segundos = (slot?.segundos || []).map(id => recipeMap[id]).filter(Boolean);

          if (primeros.length === 0 && segundos.length === 0) {
            row.push('—');
          } else {
            const parts = [];
            if (primeros.length > 0) {
              parts.push(
                '1º PLATO:\n' +
                primeros
                  .map((r, i) => `${primeros.length > 1 ? `Op.${i + 1}: ` : '• '}${r.nombre} (${Math.round(r.kcal)} kcal)`)
                  .join('\n')
              );
            }
            if (segundos.length > 0) {
              parts.push(
                '2º PLATO:\n' +
                segundos
                  .map((r, i) => `${segundos.length > 1 ? `Op.${i + 1}: ` : '• '}${r.nombre} (${Math.round(r.kcal)} kcal)`)
                  .join('\n')
              );
            }
            row.push(parts.join('\n\n'));
          }
        } else {
          const items = (Array.isArray(slot) ? slot : [])
            .map(id => recipeMap[id])
            .filter(Boolean);
          if (items.length === 0) {
            row.push('—');
          } else {
            row.push(
              items
                .map(r => '• ' + r.nombre + '\n  (' + Math.round(r.kcal) + ' kcal · ' + r.proteina + 'g P)')
                .join('\n')
            );
          }
        }
      });
      return row;
    });

    const totalsRow = ['Total Diario'];
    DIAS.forEach(dia => {
      const t = dailyTotals[dia];
      totalsRow.push(
        Math.round(t.kcal) + ' kcal\nP: ' + t.proteina.toFixed(0) + 'g · HC: ' + t.hidratos.toFixed(0) + 'g\nG: ' + t.grasas.toFixed(0) + 'g · Fibra: ' + t.fibra.toFixed(0) + 'g'
      );
    });
    body.push(totalsRow);

    autoTable(doc, {
      startY: 26,
      head,
      body,
      theme: 'grid',
      margin: { left: 10, right: 10 },
      styles: {
        font: 'helvetica',
        fontSize: 7.2,
        cellPadding: 2,
        textColor: [30, 41, 59],
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
        valign: 'top',
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        fontSize: 8.5
      },
      columnStyles: {
        0: { cellWidth: 25, fontStyle: 'bold', fillColor: [241, 245, 249] },
        1: { cellWidth: 36 },
        2: { cellWidth: 36 },
        3: { cellWidth: 36 },
        4: { cellWidth: 36 },
        5: { cellWidth: 36 },
        6: { cellWidth: 36 },
        7: { cellWidth: 36 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fillColor = [236, 253, 245];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [6, 95, 70];
        }
      }
    });

    const usedRecipes = Array.from(usedIdsSet)
      .map(id => recipeMap[id])
      .filter(Boolean);

    doc.addPage('a4', 'portrait');

    doc.setFillColor(4, 120, 87);
    doc.rect(0, 0, 210, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Recetario de la Semana: Ingredientes y Preparación', 14, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${title} · ${usedRecipes.length} platos incluidos en el menú`, 14, 16);

    let cursorY = 26;
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 14;
    const contentWidth = 210 - marginX * 2;

    usedRecipes.forEach((rec, index) => {
      const ingText = (rec.ingredientes || 'Sin ingredientes especificados').trim();
      const prepText = (rec.preparacion || 'Sin método de preparación especificado').trim();

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const ingLines = doc.splitTextToSize(ingText, contentWidth - 8);
      const prepLines = doc.splitTextToSize(prepText, contentWidth - 8);

      const lineHeight = 4.3;
      const estimatedBlockHeight =
        16 + 7 + ingLines.length * lineHeight + 7 + prepLines.length * lineHeight + 10;

      if (cursorY + Math.min(estimatedBlockHeight, 95) > pageHeight - 14) {
        doc.addPage('a4', 'portrait');
        cursorY = 16;
      }

      doc.setFillColor(241, 245, 249);
      doc.roundedRect(marginX, cursorY, contentWidth, 13, 2, 2, 'F');

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      const headerTitle = `${index + 1}. ${rec.nombre}`;
      const titleLines = doc.splitTextToSize(headerTitle, contentWidth - 6);
      doc.text(titleLines[0], marginX + 3, cursorY + 5.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(4, 120, 87);
      doc.text(
        `${rec.categoria || 'General'} · Porción: ${rec.porcion_g || 0}g · ${Math.round(rec.kcal || 0)} kcal | Prot: ${rec.proteina || 0}g | HC: ${rec.hidratos || 0}g | Grasas: ${rec.grasas || 0}g`,
        marginX + 3,
        cursorY + 10.5
      );

      cursorY += 17;

      if (cursorY + 12 > pageHeight - 14) {
        doc.addPage('a4', 'portrait');
        cursorY = 16;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.2);
      doc.setTextColor(51, 65, 85);
      doc.text('Ingredientes:', marginX + 2, cursorY);
      cursorY += 4.8;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.8);
      doc.setTextColor(30, 41, 59);
      ingLines.forEach(line => {
        if (cursorY > pageHeight - 14) {
          doc.addPage('a4', 'portrait');
          cursorY = 16;
        }
        doc.text(line, marginX + 4, cursorY);
        cursorY += lineHeight;
      });

      cursorY += 2.5;

      if (cursorY + 12 > pageHeight - 14) {
        doc.addPage('a4', 'portrait');
        cursorY = 16;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.2);
      doc.setTextColor(51, 65, 85);
      doc.text('Preparación:', marginX + 2, cursorY);
      cursorY += 4.8;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.8);
      doc.setTextColor(30, 41, 59);
      prepLines.forEach(line => {
        if (cursorY > pageHeight - 14) {
          doc.addPage('a4', 'portrait');
          cursorY = 16;
        }
        doc.text(line, marginX + 4, cursorY);
        cursorY += lineHeight;
      });

      cursorY += 3;
      if (cursorY < pageHeight - 14) {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(marginX, cursorY, marginX + contentWidth, cursorY);
        cursorY += 6;
      }
    });

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`NutriPlan Pro · Página ${i} de ${totalPages}`, pw - 14, ph - 6, { align: 'right' });
    }

    const safeFileName = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    doc.save(`${safeFileName || 'dieta-semanal'}.pdf`);
    showToast('PDF de la dieta semanal generado correctamente');
  };

  // =========================================================================
  // PANTALLA DE CARGA INICIAL
  // =========================================================================
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 text-sm">
        Verificando sesión de usuario...
      </div>
    );
  }

  // =========================================================================
  // PANTALLA DE LOGIN / SOLICITUD DE ALTA
  // =========================================================================
  if (!session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="bg-emerald-100 text-emerald-700 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto">
              <Utensils className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">NutriPlan Pro</h1>
            <p className="text-xs text-slate-500">Control nutricional y planificación personalizada de dietas</p>
          </div>

          <div className="grid grid-cols-2 bg-slate-100 p-1 rounded-xl text-sm font-medium">
            <button
              type="button"
              onClick={() => { setAuthMode('login'); setAuthMessage(null); }}
              className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                authMode === 'login' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <LogIn className="w-4 h-4" /> Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('register'); setAuthMessage(null); }}
              className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                authMode === 'register' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <UserPlus className="w-4 h-4" /> Solicitar Alta
            </button>
          </div>

          {authMessage && (
            <div className={`p-3.5 rounded-xl text-xs leading-relaxed ${
              authMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}>
              {authMessage.text}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre completo *</label>
                <input
                  required
                  type="text"
                  value={authNombre}
                  onChange={e => setAuthNombre(e.target.value)}
                  placeholder="Tu nombre"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Correo electrónico *</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  required
                  type="email"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  placeholder="ejemplo@correo.com"
                  className="w-full pl-10 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Contraseña *</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  required
                  minLength={6}
                  type="password"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full pl-10 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-md transition disabled:opacity-60"
            >
              {authSubmitting
                ? 'Procesando...'
                : authMode === 'login'
                  ? 'Entrar a la aplicación'
                  : 'Enviar solicitud de registro'}
            </button>
          </form>

          {authMode === 'register' && (
            <p className="text-[11px] text-center text-slate-400">
              Por seguridad, las cuentas nuevas requieren aprobación previa del administrador (<span className="font-medium text-slate-600">rafaelalon@gmail.com</span>).
            </p>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // PANTALLA DE ESPERA SI EL USUARIO AÚN NO ESTÁ APROBADO
  // =========================================================================
  if (!isApprovedUser) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-lg border border-slate-200 max-w-md w-full p-8 text-center space-y-4">
          <div className="bg-amber-100 text-amber-700 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Cuenta pendiente de aprobación</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Has iniciado sesión como <span className="font-semibold text-slate-800">{session.user.email}</span>, pero tu acceso todavía no ha sido autorizado por el administrador (<span className="font-medium">rafaelalon@gmail.com</span>).
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => fetchUserProfile(session.user)}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition"
            >
              Comprobar si ya estoy aprobado
            </button>
            <button
              onClick={handleLogout}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // APLICACIÓN PRINCIPAL (ADMINISTRADOR O USUARIO ESTÁNDAR APROBADO)
  // =========================================================================
  const pendingUsersCount = allUsers.filter(u => !u.aprobado).length;

  const filteredRecipes = recipes.filter(r => {
    const matchesText = r.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        r.ingredientes.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesOrigin = originFilter === 'Todas' || r.origen === originFilter;
    const matchesCategory = categoryFilter === 'Todas' || (r.categoria || 'General') === categoryFilter;
    return matchesText && matchesOrigin && matchesCategory;
  });

  const origins = ['Todas', ...Array.from(new Set(recipes.map(r => r.origen).filter(Boolean)))];
  const categories = ['Todas', ...Array.from(new Set(recipes.map(r => r.categoria || 'General')))];

  // Renderizador reutilizable para tarjetas de receta en cada hueco
  const renderRecipeCard = (dia, ing, recId, idx, tipoPlato = null, showOptionNumber = false) => {
    const r = recipeMap[recId];
    if (!r) return null;
    return (
      <div key={`${recId}-${idx}`} className="bg-white border border-slate-200 rounded-lg p-1.5 text-xs shadow-2xs group relative">
        <div
          onClick={() => setSelectedRecipeModal(r)}
          className={`font-medium text-slate-700 cursor-pointer hover:text-emerald-700 line-clamp-2 ${isAdmin ? 'pr-4' : ''}`}
          title="Haz clic para ver ingredientes y preparación"
        >
          {showOptionNumber && (
            <span className="inline-block text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1 rounded mr-1">
              Op.{idx + 1}
            </span>
          )}
          {r.nombre}
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">
          {r.kcal} kcal · {r.proteina}g P · {r.hidratos}g HC · {r.grasas}g G
        </div>
        {isAdmin && (
          <button
            onClick={() => removeRecipeFromSlot(dia, ing, idx, tipoPlato)}
            className="absolute top-1.5 right-1 text-slate-300 hover:text-rose-500"
            title="Quitar opción"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  };

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
              <p className="text-xs text-emerald-100 flex items-center gap-1.5">
                {isAdmin ? (
                  <><ShieldCheck className="w-3.5 h-3.5 text-amber-300" /> Administrador · {userProfile?.email}</>
                ) : (
                  <><Database className="w-3 h-3" /> {userProfile?.nombre || userProfile?.email} (Solo lectura)</>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex items-center gap-1.5 bg-emerald-800/60 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('planificador')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'planificador' ? 'bg-white text-emerald-800 shadow' : 'text-emerald-100 hover:bg-emerald-700/50'
                }`}
              >
                <Calendar className="w-4 h-4" /> {isAdmin ? 'Dieta Semanal' : 'Mis Dietas'}
              </button>

              {isAdmin && (
                <>
                  <button
                    onClick={() => setActiveTab('recetario')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                      activeTab === 'recetario' ? 'bg-white text-emerald-800 shadow' : 'text-emerald-100 hover:bg-emerald-700/50'
                    }`}
                  >
                    <Utensils className="w-4 h-4" /> Recetario ({recipes.length})
                  </button>
                  <button
                    onClick={() => {
                      setEditingRecipeId(null);
                      setNewRecipe(EMPTY_RECIPE_FORM);
                      setActiveTab('nueva-receta');
                    }}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                      activeTab === 'nueva-receta' ? 'bg-white text-emerald-800 shadow' : 'text-emerald-100 hover:bg-emerald-700/50'
                    }`}
                  >
                    {editingRecipeId ? (
                      <><Pencil className="w-4 h-4" /> Editando Receta</>
                    ) : (
                      <><Plus className="w-4 h-4" /> Nueva Receta</>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('usuarios')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition relative ${
                      activeTab === 'usuarios' ? 'bg-white text-emerald-800 shadow' : 'text-emerald-100 hover:bg-emerald-700/50'
                    }`}
                  >
                    <Users className="w-4 h-4" /> Usuarios
                    {pendingUsersCount > 0 && (
                      <span className="bg-amber-400 text-slate-900 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                        {pendingUsersCount}
                      </span>
                    )}
                  </button>
                </>
              )}
            </nav>

            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-900/60 hover:bg-emerald-950 text-emerald-100 transition"
            >
              <LogOut className="w-4 h-4" /> Salir
            </button>
          </div>
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
          <div className="text-center py-20 text-slate-500">Cargando dietas y recetas...</div>
        ) : (
          <>
            {/* PESTAÑA 1: PLANIFICADOR DE DIETA SEMANAL */}
            {activeTab === 'planificador' && (
              <div className="space-y-6">
                {!isAdmin && weeklyDiets.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
                    <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
                    <h2 className="text-lg font-bold text-slate-800">Aún no tienes dietas semanales asignadas</h2>
                    <p className="text-sm text-slate-500">
                      Cuando el administrador te asigne tu menú semanal, aparecerá aquí automáticamente con todos sus platos, ingredientes y preparación.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Barra de controles de dieta */}
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
                        {isAdmin ? (
                          <input
                            type="text"
                            value={dietName}
                            onChange={(e) => setDietName(e.target.value)}
                            placeholder="Nombre de la dieta semanal..."
                            className="font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        ) : (
                          <h2 className="font-bold text-slate-800 text-base px-1">{dietName}</h2>
                        )}

                        {weeklyDiets.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={currentDietId}
                              onChange={(e) => {
                                const found = weeklyDiets.find(d => d.id === e.target.value);
                                if (found) {
                                  setCurrentDietId(found.id);
                                  setDietName(found.nombre);
                                  setAssignedUserId(found.usuario_id || '');
                                  setPlan(normalizeLoadedPlan(found.plan));
                                }
                              }}
                              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm"
                            >
                              {weeklyDiets.map(d => (
                                <option key={d.id} value={d.id}>{d.nombre}</option>
                              ))}
                            </select>

                            {isAdmin && (
                              <button
                                onClick={handleDeleteDiet}
                                title="Eliminar dieta seleccionada"
                                className="p-2 rounded-xl text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}

                        {/* Selector de Usuario Asignado (Solo Admin) */}
                        {isAdmin && (
                          <div className="flex items-center gap-1.5 bg-emerald-50/70 border border-emerald-200 rounded-xl px-2.5 py-1.5">
                            <Users className="w-4 h-4 text-emerald-700" />
                            <select
                              value={assignedUserId}
                              onChange={(e) => setAssignedUserId(e.target.value)}
                              className="bg-transparent text-xs font-semibold text-emerald-900 focus:outline-none"
                              title="Asignar esta dieta a un usuario"
                            >
                              <option value="">Sin asignar (Solo Admin)</option>
                              {allUsers.filter(u => u.aprobado).map(u => (
                                <option key={u.id} value={u.id}>
                                  Asignada a: {u.nombre || u.email} ({u.email})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isAdmin && (
                          <>
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
                          </>
                        )}

                        <button
                          onClick={handleExportDietPDF}
                          title="Descargar PDF con el cuadrante semanal, ingredientes y preparación de cada receta"
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition"
                        >
                          <FileDown className="w-4 h-4" /> Descargar PDF
                        </button>

                        {isAdmin && (
                          <button
                            onClick={handleSaveDiet}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition"
                          >
                            <Save className="w-4 h-4" /> Guardar Dieta
                          </button>
                        )}
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

                    {/* Cuadrícula de 7 días */}
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

                            <div className="p-2.5 space-y-2.5 flex-1">
                              {INGESTAS.map(ing => {
                                const isDoubleMeal = INGESTAS_DOBLES.includes(ing);

                                if (isDoubleMeal) {
                                  const slot = plan[dia]?.[ing] || { primeros: [], segundos: [] };
                                  const primeros = slot.primeros || [];
                                  const segundos = slot.segundos || [];

                                  return (
                                    <div key={ing} className="bg-slate-50 rounded-xl p-2 border border-slate-200/80 space-y-2">
                                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200/70 pb-1">
                                        {ing}
                                      </div>

                                      {/* Bloque 1º Plato */}
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-semibold text-emerald-700">
                                            1º Plato {primeros.length > 1 ? `(${primeros.length} opc.)` : ''}
                                          </span>
                                          {isAdmin && (
                                            <button
                                              onClick={() => {
                                                setPickerCategory('Todas');
                                                setPickerTarget({ dia, ingesta: ing, tipoPlato: 'primeros' });
                                              }}
                                              className="text-emerald-600 hover:bg-emerald-100 px-1.5 py-0.5 rounded-md transition flex items-center gap-0.5 text-[10px] font-semibold"
                                              title="Añadir opción de primer plato"
                                            >
                                              <Plus className="w-3 h-3" /> Opción
                                            </button>
                                          )}
                                        </div>
                                        {primeros.length === 0 ? (
                                          <div className="text-[10px] text-slate-400 italic">Sin 1º plato</div>
                                        ) : (
                                          <div className="space-y-1">
                                            {primeros.map((recId, idx) =>
                                              renderRecipeCard(dia, ing, recId, idx, 'primeros', primeros.length > 1)
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      {/* Bloque 2º Plato */}
                                      <div className="space-y-1 pt-1 border-t border-slate-200/60">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-semibold text-emerald-700">
                                            2º Plato {segundos.length > 1 ? `(${segundos.length} opc.)` : ''}
                                          </span>
                                          {isAdmin && (
                                            <button
                                              onClick={() => {
                                                setPickerCategory('Todas');
                                                setPickerTarget({ dia, ingesta: ing, tipoPlato: 'segundos' });
                                              }}
                                              className="text-emerald-600 hover:bg-emerald-100 px-1.5 py-0.5 rounded-md transition flex items-center gap-0.5 text-[10px] font-semibold"
                                              title="Añadir opción de segundo plato"
                                            >
                                              <Plus className="w-3 h-3" /> Opción
                                            </button>
                                          )}
                                        </div>
                                        {segundos.length === 0 ? (
                                          <div className="text-[10px] text-slate-400 italic">Sin 2º plato</div>
                                        ) : (
                                          <div className="space-y-1">
                                            {segundos.map((recId, idx) =>
                                              renderRecipeCard(dia, ing, recId, idx, 'segundos', segundos.length > 1)
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }

                                // Ingestas simples (Desayuno, Media Mañana, Merienda)
                                const items = Array.isArray(plan[dia]?.[ing]) ? plan[dia][ing] : [];
                                return (
                                  <div key={ing} className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{ing}</span>
                                      {isAdmin && (
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
                                      )}
                                    </div>
                                    {items.length === 0 ? (
                                      <div className="text-[11px] text-slate-400 italic py-1">Sin asignar</div>
                                    ) : (
                                      <div className="space-y-1">
                                        {items.map((recId, idx) =>
                                          renderRecipeCard(dia, ing, recId, idx, null, false)
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

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
                  </>
                )}
              </div>
            )}

            {/* PESTAÑA 2: RECETARIO Y FICHAS (SOLO ADMIN) */}
            {activeTab === 'recetario' && isAdmin && (
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
                  </div>

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
                          <Eye className="w-4 h-4" /> Ver Ficha
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleStartEditRecipe(rec)}
                            className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg transition"
                            title="Modificar receta"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Editar
                          </button>
                          <button
                            onClick={() => handleDeleteRecipe(rec.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded-lg transition"
                            title="Eliminar receta"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PESTAÑA 3: CREAR O MODIFICAR RECETA (SOLO ADMIN) */}
            {activeTab === 'nueva-receta' && isAdmin && (
              <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between gap-4 mb-1">
                  <h2 className="text-xl font-bold text-slate-800">
                    {editingRecipeId ? 'Modificar Receta' : 'Añadir Nueva Receta'}
                  </h2>
                  {editingRecipeId && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      Modo edición
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mb-6">
                  {editingRecipeId
                    ? 'Actualiza los ingredientes, preparación, categoría o valores nutricionales y guarda los cambios.'
                    : 'Completa los datos, categoría y valores nutricionales para incorporarla a tu base de datos.'}
                </p>

                <form onSubmit={handleSaveRecipe} className="space-y-5">
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
                      onClick={handleCancelRecipeForm}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                    >
                      {editingRecipeId ? 'Guardar Cambios' : 'Guardar Receta'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* PESTAÑA 4: GESTIÓN DE USUARIOS Y APROBACIONES (SOLO ADMIN) */}
            {activeTab === 'usuarios' && isAdmin && (
              <div className="max-w-4xl mx-auto space-y-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">Control de Acceso y Usuarios</h2>
                    <p className="text-xs text-slate-500">
                      Aprueba las solicitudes de registro nuevas, asigna roles y gestiona quién puede entrar al sistema.
                    </p>
                  </div>
                  <div className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
                    Pendientes de aprobar: {pendingUsersCount}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Usuario</th>
                          <th className="px-4 py-3">Estado</th>
                          <th className="px-4 py-3">Perfil / Rol</th>
                          <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {allUsers.map(u => {
                          const isOwner = u.email.toLowerCase() === 'rafaelalon@gmail.com';
                          return (
                            <tr key={u.id} className="hover:bg-slate-50/70">
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-800">{u.nombre || 'Sin nombre'}</div>
                                <div className="text-xs text-slate-500">{u.email}</div>
                              </td>
                              <td className="px-4 py-3">
                                {u.aprobado ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Aprobado
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                    <Clock className="w-3.5 h-3.5" /> Pendiente
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {isOwner ? (
                                  <span className="text-xs font-bold text-emerald-800">Administrador Principal</span>
                                ) : (
                                  <select
                                    value={u.rol}
                                    onChange={(e) => handleChangeUserRole(u, e.target.value)}
                                    className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700"
                                  >
                                    <option value="usuario">Usuario Estándar (Solo lectura)</option>
                                    <option value="admin">Administrador (Control total)</option>
                                  </select>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {!isOwner && (
                                  <div className="inline-flex items-center gap-2">
                                    <button
                                      onClick={() => handleToggleApproveUser(u)}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                                        u.aprobado
                                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                          : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs'
                                      }`}
                                    >
                                      {u.aprobado ? 'Bloquear' : 'Aprobar Acceso'}
                                    </button>
                                    <button
                                      onClick={() => handleDeleteUserProfile(u)}
                                      title="Eliminar usuario"
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* MODAL: DETALLE COMPLETO DE RECETA (Disponible para todos los usuarios aprobados) */}
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
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={() => handleStartEditRecipe(selectedRecipeModal)}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                )}
                <button onClick={() => setSelectedRecipeModal(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
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

      {/* MODAL: SELECTOR DE RECETA PARA EL PLAN SEMANAL (SOLO ADMIN) */}
      {pickerTarget && isAdmin && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-800">Añadir a {pickerTarget.dia}</h3>
                <p className="text-xs text-slate-500">
                  Ingesta: {pickerTarget.ingesta}
                  {pickerTarget.tipoPlato === 'primeros' && ' · Opción de 1º Plato'}
                  {pickerTarget.tipoPlato === 'segundos' && ' · Opción de 2º Plato'}
                </p>
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
                    onClick={() => addRecipeToSlot(pickerTarget.dia, pickerTarget.ingesta, r.id, pickerTarget.tipoPlato)}
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
