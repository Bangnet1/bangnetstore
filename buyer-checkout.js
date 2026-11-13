import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

(() => {
  const SUPABASE_URL = 'https://wectusglyacjqtapyvpr.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_0uDuEdDgIlOFCW23e_-o9g_RadhCYus';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const style = document.createElement('style');
  style.textContent = `
    #buyerAccountButton{position:fixed;right:18px;top:88px;z-index:18;border:1px solid #ddd;border-radius:999px;background:#fff;color:#111;padding:9px 14px;font-weight:700;box-shadow:0 3px 14px #0001;cursor:pointer}
    #buyerLayer{position:fixed;inset:0;z-index:1000;background:#0009;display:none;overflow:auto;padding:18px}
    #buyerLayer.open{display:block}
    .buyerBox{max-width:480px;margin:5vh auto;background:#fff;color:#171717;border-radius:16px;padding:20px;box-shadow:0 18px 60px #0004}
    .buyerHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
    .buyerHead h2{font-size:20px;margin:0}.buyerClose{border:0;background:#f1f1f1;border-radius:9px;padding:7px 11px;font-size:20px;cursor:pointer}
    .buyerField{display:grid;gap:6px;margin:12px 0}.buyerField label{font-size:13px;font-weight:700}
    .buyerField input{width:100%;padding:12px;border:1px solid #ddd;border-radius:9px;font:inherit}
    .buyerPrimary{width:100%;border:0;border-radius:9px;background:#111;color:white;padding:12px;font-weight:750;cursor:pointer;margin-top:8px}
    .buyerSecondary{border:1px solid #ddd;background:white;color:#111;border-radius:9px;padding:10px 12px;cursor:pointer}
    .buyerMuted{color:#666;font-size:13px;line-height:1.5}.buyerError{color:#b42318;font-size:13px;white-space:pre-wrap}
    .buyerOrder{border:1px solid #e5e5e5;border-radius:10px;padding:12px;margin:10px 0;font-size:13px}
    .buyerOrder strong{display:block;margin-bottom:5px}.buyerStatus{display:inline-block;background:#f2f2f2;border-radius:20px;padding:4px 8px;margin-top:7px}
    .buyerQr{display:block;width:min(100%,300px);height:auto;object-fit:contain;margin:12px auto;border:1px solid #ddd;border-radius:10px}
    @media(max-width:600px){#buyerAccountButton{top:auto;bottom:90px;right:12px}}
  `;
  document.head.appendChild(style);

  const accountButton = document.createElement('button');
  accountButton.id = 'buyerAccountButton';
  accountButton.type = 'button';
  accountButton.textContent = 'Akun / Pesanan';
  document.body.appendChild(accountButton);

  const layer = document.createElement('div');
  layer.id = 'buyerLayer';
  layer.innerHTML = '<section class="buyerBox" role="dialog" aria-modal="true" aria-labelledby="buyerTitle"><div class="buyerHead"><h2 id="buyerTitle">Akun Pembeli</h2><button class="buyerClose" type="button" aria-label="Tutup">×</button></div><div id="buyerContent"></div></section>';
  document.body.appendChild(layer);
  const content = layer.querySelector('#buyerContent');
  const close = () => layer.classList.remove('open');
  layer.querySelector('.buyerClose').addEventListener('click', close);
  layer.addEventListener('click', e => { if (e.target === layer) close(); });
  const show = (html) => { content.innerHTML = html; layer.classList.add('open'); };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rupiah = value => 'Rp' + Number(value || 0).toLocaleString('id-ID');
  let currentUser = null;

  async function getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    currentUser = data.user || null;
    return currentUser;
  }

  function authForm(mode = 'login', message = '') {
    const signup = mode === 'signup';
    show(`
      <p class="buyerMuted">${signup ? 'Buat akun agar pesanan dan bukti pembayaran tersimpan di riwayat Anda.' : 'Masuk untuk mengirim bukti pembayaran dan melihat status pesanan.'}</p>
      <form id="buyerAuthForm">
        <div class="buyerField"><label for="buyerEmail">Email</label><input id="buyerEmail" type="email" autocomplete="email" required maxlength="254"></div>
        <div class="buyerField"><label for="buyerPassword">Kata sandi</label><input id="buyerPassword" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" maxlength="72"></div>
        <p class="buyerError" id="buyerAuthMessage">${esc(message)}</p>
        <button class="buyerPrimary" type="submit">${signup ? 'Daftar akun' : 'Masuk'}</button>
      </form>
      <button class="buyerSecondary" id="buyerSwitch" type="button" style="width:100%;margin-top:10px">${signup ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}</button>
    `);
    content.querySelector('#buyerSwitch').onclick = () => authForm(signup ? 'login' : 'signup');
    content.querySelector('#buyerAuthForm').onsubmit = async event => {
      event.preventDefault();
      const email = content.querySelector('#buyerEmail').value.trim().toLowerCase();
      const password = content.querySelector('#buyerPassword').value;
      const output = content.querySelector('#buyerAuthMessage');
      output.textContent = 'Memproses…';
      const result = signup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) { output.textContent = result.error.message; return; }
      if (signup && !result.data.session) {
        output.textContent = 'Pendaftaran berhasil. Silakan buka email untuk konfirmasi, lalu masuk kembali.';
        return;
      }
      currentUser = result.data.user || result.data.session?.user || null;
      await renderAccount();
    };
  }

  async function renderAccount() {
    try {
      const user = await getUser();
      if (!user) { authForm(); return; }
      const { data: orders, error } = await supabase.from('sales_orders')
        .select('id,created_at,order_items,total_amount,status,customer_contact,payment_proof_path,courier,tracking_number')
        .eq('customer_user_id', user.id).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      const cards = (orders || []).map(order => {
        const items = Array.isArray(order.order_items)
          ? order.order_items.map(item => esc(item.product_name || item.name) + ' × ' + esc(item.quantity)).join('<br>')
          : 'Rincian produk tidak tersedia';
        return `<article class="buyerOrder"><strong>Pesanan #${esc(order.id)}</strong><span>${new Date(order.created_at).toLocaleString('id-ID')}</span><p>${items}</p><b>${rupiah(order.total_amount)}</b><br><span class="buyerStatus">${esc(order.status)}</span>${order.courier ? '<p>Pengiriman: '+esc(order.courier)+' '+esc(order.tracking_number || '')+'</p>' : ''}</article>`;
      }).join('');
      show(`
        <p class="buyerMuted">Masuk sebagai <b>${esc(user.email)}</b></p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="buyerPrimary" id="buyerStartCheckout" type="button" style="flex:1">Lanjutkan pembayaran</button><button class="buyerSecondary" id="buyerLogout" type="button">Keluar</button></div>
        <h3>Riwayat pesanan</h3>${cards || '<p class="buyerMuted">Belum ada pesanan.</p>'}
      `);
      content.querySelector('#buyerLogout').onclick = async () => { await supabase.auth.signOut(); currentUser = null; authForm(); };
      content.querySelector('#buyerStartCheckout').onclick = () => { close(); openPaymentForm(); };
    } catch (error) {
      show('<p class="buyerError">Tidak dapat memuat akun: ' + esc(error.message) + '</p>');
    }
  }

  function cartSnapshot() {
    const cart = window.cart;
    const lookup = window.byId;
    if (!cart || typeof lookup !== 'function') throw new Error('Keranjang belum siap. Muat ulang halaman lalu coba kembali.');
    const grouped = new Map();
    Object.keys(cart).forEach(id => {
      const item = lookup(id);
      const quantity = Number(cart[id] || 0);
      if (!item || quantity <= 0) return;
      const productId = Number(item.dbId);
      const displayPrice = Number(item.p);
      if (!Number.isSafeInteger(productId) || productId < 1) {
        throw new Error('Produk "' + String(item.n) + '" belum memiliki data stok yang cocok di database. Silakan hubungi admin.');
      }
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(displayPrice) || displayPrice < 0) {
        throw new Error('Rincian harga atau jumlah produk tidak valid.');
      }
      const existing = grouped.get(productId);
      if (existing) {
        if (existing.displayPrice !== displayPrice) throw new Error('Harga produk tidak konsisten. Muat ulang halaman lalu coba kembali.');
        existing.quantity += quantity;
        if (!Number.isSafeInteger(existing.quantity) || existing.quantity > 100) throw new Error('Jumlah produk melebihi batas pesanan.');
      } else {
        grouped.set(productId, { product_id: productId, quantity, product_name: String(item.n), displayPrice });
      }
    });
    const groupedItems = Array.from(grouped.values());
    if (!groupedItems.length) throw new Error('Keranjang masih kosong.');
    if (groupedItems.some(item => item.quantity > 100)) throw new Error('Jumlah produk melebihi batas pesanan.');
    const total = groupedItems.reduce((sum, item) => sum + item.displayPrice * item.quantity, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Total pesanan tidak valid.');
    return {
      items: groupedItems.map(({ product_id, quantity, product_name }) => ({ product_id, quantity, product_name })),
      total
    };
  }

  async function openPaymentForm() {
    try {
      const user = await getUser();
      if (!user) { authForm(); return; }
      const snapshot = cartSnapshot();
      const oldQr = document.querySelector('#pay .qr');
      const qrMarkup = oldQr ? '<img class="buyerQr" alt="QRIS Bangnet" src="' + oldQr.src + '">' : '';
      show(`
        <p class="buyerMuted">Total pesanan: <b>${rupiah(snapshot.total)}</b>. Bayar melalui QRIS, lalu unggah bukti pembayaran di bawah. Admin akan memeriksa pembayaran secara manual.</p>
        ${qrMarkup}
        <form id="buyerProofForm">
          <div class="buyerField"><label for="buyerWhatsapp">Nomor WhatsApp aktif</label><input id="buyerWhatsapp" type="tel" inputmode="tel" autocomplete="tel" placeholder="08xxxxxxxxxx atau 628xxxxxxxxxx" required maxlength="20"></div>
          <div class="buyerField"><label for="buyerProof">Bukti pembayaran (JPG, PNG, WEBP; maksimal 5 MB)</label><input id="buyerProof" type="file" accept="image/jpeg,image/png,image/webp" required></div>
          <p class="buyerError" id="buyerProofMessage"></p>
          <button class="buyerPrimary" type="submit">Kirim bukti pembayaran</button>
        </form>
      `);
      content.querySelector('#buyerProofForm').onsubmit = async event => {
        event.preventDefault();
        const output = content.querySelector('#buyerProofMessage');
        const button = content.querySelector('button[type="submit"]');
        const phoneRaw = content.querySelector('#buyerWhatsapp').value.trim();
        const phone = phoneRaw.replace(/[\s().-]/g, '').replace(/^0/, '62');
        const file = content.querySelector('#buyerProof').files?.[0];
        if (!/^62[0-9]{8,16}$/.test(phone)) { output.textContent = 'Nomor WhatsApp tidak valid. Gunakan format 08… atau 62…'; return; }
        if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
          output.textContent = 'Pilih gambar JPG, PNG, atau WEBP maksimal 5 MB.'; return;
        }
        button.disabled = true; button.textContent = 'Mengunggah…'; output.textContent = '';
        let path = null;
        try {
          const latest = cartSnapshot();
          if (latest.total !== snapshot.total || JSON.stringify(latest.items) !== JSON.stringify(snapshot.items)) {
            throw new Error('Keranjang berubah. Tutup formulir dan buka kembali agar total diperbarui.');
          }
          const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
          path = 'orders/' + user.id + '/' + crypto.randomUUID() + '.' + extension;
          const upload = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
          if (upload.error) throw upload.error;
          const order = await supabase.rpc('create_buyer_order', {
            p_order_items: latest.items,
            p_customer_contact: phone,
            p_payment_proof_path: path
          });
          if (order.error) throw order.error;
          show('<h3>Bukti pembayaran terkirim</h3><p class="buyerMuted">Pesanan #' + esc(order.data) + ' sudah tercatat. Total dan harga telah diperiksa oleh database. Status tetap menunggu verifikasi sampai admin memeriksa pembayaran.</p><button class="buyerPrimary" id="buyerViewOrders" type="button">Lihat riwayat pesanan</button>');
          content.querySelector('#buyerViewOrders').onclick = renderAccount;
          if (window.cart) { Object.keys(window.cart).forEach(id => delete window.cart[id]); if (typeof window.draw === 'function') window.draw(); }
        } catch (error) {
          if (path) { try { await supabase.storage.from('payment-proofs').remove([path]); } catch (_) {} }
          output.textContent = 'Gagal mengirim bukti: ' + error.message;
          button.disabled = false; button.textContent = 'Coba kirim lagi';
        }
      };
    } catch (error) {
      show('<p class="buyerError">' + esc(error.message) + '</p>');
    }
  }

  accountButton.addEventListener('click', renderAccount);
  const checkoutButton = document.getElementById('go');
  if (checkoutButton) checkoutButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPaymentForm();
  }, true);
  supabase.auth.onAuthStateChange((_event, session) => { currentUser = session?.user || null; });
})();
