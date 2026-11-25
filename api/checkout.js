const SUPABASE_URL = "https://ewmdyjcjxwibhfjejhwe.supabase.co";

export async function deduireStocksServeur(cart, supabaseServiceKey) {
  if (!Array.isArray(cart) || !supabaseServiceKey) return;
  const lignes = [];

  cart.forEach(item => {
    if (item.type === 'lot' && item.parfums) {
      Object.entries(item.parfums).forEach(([parfumId, qte]) => {
        if (qte > 0) lignes.push({ id: `fondant-${parfumId}`, qte: qte * item.quantity });
      });
    } else if (item.type === 'tablette') {
      lignes.push({ id: `tablette-${item.parfumId}`, qte: item.quantity });
    } else if (item.type === 'plateau') {
      lignes.push({ id: item.plateauId, qte: item.quantity });
    } else if (item.type === 'creation') {
      lignes.push({ id: item.creationId, qte: item.quantity });
    } else if (item.type === 'mystere') {
      lignes.push({ id: 'lot-mystere', qte: item.quantity });
    }
  });

  for (const ligne of lignes) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/decrementer_stock`, {
      method: "POST",
      headers: {
        "apikey": supabaseServiceKey,
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_id: ligne.id, p_qte: ligne.qte })
    });
  }
}

export async function envoyerEmailCommande(orderData) {
  if (!orderData) return;

  const {
    amount,
    sousTotal,
    fraisDePort,
    estLivraisonOfferte,
    pointRelais,
    clientEmail,
    cart,
    clientName,
    clientPhone,
    deliveryAddress,
    discount,
    remarque,
    remarques
  } = orderData;

  const serviceId = process.env.EMAILJS_SERVICE_ID || "service_cbfk3mr";
  const templateId = process.env.EMAILJS_TEMPLATE_ID || "template_jeryfp3";
  const publicKey = process.env.EMAILJS_PUBLIC_KEY || "rnYePJTMswP2wkX6O";
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  const dateFormatee = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris'
  });

  const articlesList = (cart || []).map(item =>
    `• ${item.quantity}x ${item.title}${item.subtitle ? ` (${item.subtitle})` : ''} — ${(item.price * item.quantity).toFixed(2).replace('.', ',')} €`
  ).join('\n');

  const templateParams = {
    to_email: "debstyle-coiffure@hotmail.com, renaut.lucas@outlook.fr, pooky49@hotmail.fr",
    date: dateFormatee,
    client_name: clientName || 'Client',
    client_email: clientEmail || 'Non renseigné',
    client_phone: clientPhone || 'Non renseigné',
    delivery_address: deliveryAddress || 'Non renseignée',
    point_relais: pointRelais || 'Livraison à domicile',
    articles_list: articlesList,
    details_articles: articlesList,
    subtotal: `${parseFloat(sousTotal || 0).toFixed(2).replace('.', ',')} €`,
    discount: discount || '0,00 €',
    shipping: estLivraisonOfferte ? "OFFERTS" : `${parseFloat(fraisDePort || 0).toFixed(2).replace('.', ',')} €`,
    total: `${parseFloat(amount || 0).toFixed(2).replace('.', ',')} €`,
    remarque: remarque || remarques || "Aucune consigne particulière"
  };

  const emailjsPayload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: templateParams
  };

  if (privateKey) {
    emailjsPayload.accessToken = privateKey;
  }

  const emailjsRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(emailjsPayload)
  });

  if (!emailjsRes.ok) {
    const errorDetails = await emailjsRes.text();
    console.error("Échec envoi EmailJS :", emailjsRes.status, errorDetails);
  }
}

export async function finaliserCommandeSiNonTraitee(checkoutId, supabaseServiceKey) {
  // Passage atomique de PENDING à PAID : garantit un traitement unique
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/commandes_sumup?checkout_id=eq.${encodeURIComponent(checkoutId)}&statut=eq.PENDING`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseServiceKey,
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        statut: "PAID",
        paid_at: new Date().toISOString()
      })
    }
  );

  if (!patchRes.ok) {
    console.error("Erreur Supabase PATCH :", await patchRes.text());
    return false;
  }

  const updatedRows = await patchRes.json();

  // Si aucune ligne n'a été modifiée, la commande a déjà été traitée
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    return true;
  }

  const orderData = updatedRows[0].order_data;
  await deduireStocksServeur(orderData.cart, supabaseServiceKey);
  await envoyerEmailCommande(orderData);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const apiKey = process.env.SUMUP_API_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseServiceKey) {
    return res.status(500).json({ error: "Variables d'environnement manquantes." });
  }

  const body = req.body || {};
  const checkoutId = body.id || body.checkout_id;

  if (!checkoutId) {
    return res.status(400).json({ error: "Identifiant checkout absent." });
  }

  try {
    // Vérification officielle du statut auprès de l'API SumUp
    const checkResponse = await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    const checkData = await checkResponse.json();

    if (checkResponse.ok && checkData.status === 'PAID') {
      await finaliserCommandeSiNonTraitee(checkoutId, supabaseServiceKey);
    }

    // Toujours répondre 200 OK à SumUp pour confirmer la réception du webhook
    return res.status(200).json({ received: true, status: checkData.status });
  } catch (error) {
    console.error("Erreur webhook SumUp :", error);
    return res.status(500).json({ error: "Erreur serveur webhook." });
  }
}