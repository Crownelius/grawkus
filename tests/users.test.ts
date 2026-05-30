import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUser,
  listUsers,
  getUser,
  getActiveUser,
  setActiveUser,
  updateUser,
  deleteUser,
  setUserMetadata,
  getUserMetadata,
  printUserList,
  buildUserContext,
} from '../src/users.js';

describe('Users Table', () => {
  beforeEach(() => {
    // Reset state by deleting all users
    const users = listUsers();
    for (const u of users) {
      deleteUser(u.id);
    }
  });

  describe('createUser', () => {
    it('returns user with id', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      expect(u.id.length).toBeGreaterThan(0);
    });

    it('sets name', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      expect(u.name).toBe('Alice');
    });

    it('sets email', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      expect(u.email).toBe('alice@example.com');
    });

    it('sets role', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      expect(u.role).toBe('admin');
    });

    it('defaults active to false', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      expect(u.active).toBe(false);
    });

    it('sets metadata object', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      expect(u.metadata).toBeDefined();
      expect(typeof u.metadata).toBe('object');
    });
  });

  describe('listUsers', () => {
    it('returns created user', () => {
      createUser('Alice', 'alice@example.com', 'admin');
      const users = listUsers();
      expect(users.length).toBe(1);
    });

    it('returns correct user', () => {
      createUser('Alice', 'alice@example.com', 'admin');
      const users = listUsers();
      expect(users[0].name).toBe('Alice');
    });
  });

  describe('getUser', () => {
    it('returns user', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      const fetched = getUser(u.id);
      expect(fetched).not.toBeNull();
    });

    it('returns correct user', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      const fetched = getUser(u.id);
      expect(fetched!.name).toBe('Alice');
    });

    it('returns null for missing user', () => {
      const missing = getUser('nonexistent-id-12345');
      expect(missing).toBeNull();
    });
  });

  describe('getActiveUser', () => {
    it('returns null when no active user', () => {
      const active = getActiveUser();
      expect(active).toBeNull();
    });

    it('returns the active user', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      setActiveUser(u.id);
      const activeNow = getActiveUser();
      expect(activeNow!.id).toBe(u.id);
    });

    it('returns correct user', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      setActiveUser(u.id);
      const activeNow = getActiveUser();
      expect(activeNow!.name).toBe('Alice');
    });
  });

  describe('setActiveUser', () => {
    it('returns user', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      const activated = setActiveUser(u.id);
      expect(activated).not.toBeNull();
    });

    it('sets active=true', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      const activated = setActiveUser(u.id);
      expect(activated!.active).toBe(true);
    });

    it('deactivates previous active user', () => {
      const u1 = createUser('Alice', 'alice@example.com', 'admin');
      const u2 = createUser('Bob', 'bob@example.com', 'dev');
      setActiveUser(u1.id);
      setActiveUser(u2.id);
      expect(getUser(u1.id)!.active).toBe(false);
      expect(getUser(u2.id)!.active).toBe(true);
    });
  });

  describe('updateUser', () => {
    it('changes name', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      const updated = updateUser(u.id, { name: 'Robert' });
      expect(updated!.name).toBe('Robert');
    });

    it('changes email', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      const updated = updateUser(u.id, { email: 'robert@example.com' });
      expect(updated!.email).toBe('robert@example.com');
    });
  });

  describe('setUserMetadata', () => {
    it('set/get roundtrip', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      setUserMetadata(u.id, 'team', 'backend');
      const meta = getUserMetadata(u.id, 'team');
      expect(meta).toBe('backend');
    });
  });

  describe('deleteUser', () => {
    it('returns true', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      const deleted = deleteUser(u.id);
      expect(deleted).toBe(true);
    });

    it('deleted user no longer exists', () => {
      const u = createUser('Alice', 'alice@example.com', 'admin');
      deleteUser(u.id);
      expect(getUser(u.id)).toBeNull();
    });

    it('returns false for missing user', () => {
      const deleted = deleteUser('nonexistent-id-12345');
      expect(deleted).toBe(false);
    });
  });

  describe('buildUserContext', () => {
    it('includes user name', () => {
      const u = createUser('Robert', 'robert@example.com', 'dev');
      setActiveUser(u.id);
      const ctx = buildUserContext();
      expect(ctx).toContain('Robert');
    });
  });

  describe('printUserList', () => {
    it('runs without error', () => {
      createUser('Alice', 'alice@example.com', 'admin');
      expect(() => printUserList()).not.toThrow();
    });
  });
});