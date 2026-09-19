/**
 * In-Memory Cache Service for High Performance Dashboard & WebSocket
 * 
 * ให้บริการ Key-Value Cache ในหน่วยความจำ (RAM) พร้อมระบบ TTL และ Invalidation
 * เพื่อป้องกันการสแกนและประมวลผลข้อมูลขนาดใหญ่จาก Database โดยตรงทุกครั้ง
 */

class CacheService {
  constructor() {
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;

    // Periodically clean expired keys every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref(); // Don't prevent process exit
    }
  }

  /**
   * บันทึกข้อมูลลง Cache
   * @param {string} key 
   * @param {any} value 
   * @param {number} ttlMs ระยะเวลาคงอยู่ (มิลลิวินาที) ค่าเริ่มต้น: 60,000 ms (1 นาที)
   */
  set(key, value, ttlMs = 60000) {
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now()
    });
    return value;
  }

  /**
   * ดึงข้อมูลจาก Cache
   * @param {string} key 
   * @returns {any|null} คืนค่าที่แคชไว้ หรือ null ถ้าไม่มี/หมดอายุ
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.misses++;
      return null;
    }

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return item.value;
  }

  /**
   * ตรวจสอบว่ามี Key นี้ในแคชและยังไม่หมดอายุหรือไม่
   * @param {string} key 
   */
  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * ลบ Key ออกจาก Cache
   * @param {string} key 
   */
  del(key) {
    return this.cache.delete(key);
  }

  /**
   * ลบ Cache ตาม Prefix (เช่น 'summary:' หรือ 'analytics:')
   * @param {string} prefix 
   */
  invalidatePrefix(prefix) {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * เคลียร์ข้อมูลทั้งหมดใน Cache
   */
  flush() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * กวาดล้างข้อมูลที่หมดอายุ
   */
  cleanupExpired() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * รายงานสถิติการใช้งาน Cache
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) : '0.0';
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`
    };
  }
}

// Export singleton instance
module.exports = new CacheService();
