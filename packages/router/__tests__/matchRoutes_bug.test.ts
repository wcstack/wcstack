import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { matchRoutes } from '../src/matchRoutes';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import './setup';

describe('matchRoutesバグ再現', () => {
    let router: Router;

    beforeEach(() => {
        document.body.innerHTML = '';
        router = document.createElement('wcs-router') as Router;
        document.body.appendChild(router);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('親がマッチする場合でもネストされたindexルートを見つけること', () => {
        // Parent: /users
        const parentRoute = document.createElement('wcs-route') as Route;
        parentRoute.setAttribute('path', '/users');
        
        // Child: index
        const childRoute = document.createElement('wcs-route') as Route;
        childRoute.setAttribute('index', '');

        // Initialize (this will link them together)
        parentRoute.initialize(router, null);
        childRoute.initialize(router, parentRoute);

        // Verify structure
        expect(router.routeChildNodes).toContain(parentRoute);
        expect(parentRoute.routeChildNodes).toContain(childRoute);

        // Path to test
        const path = '/users';

        // Execute
        const result = matchRoutes(router, path);

        expect(result).not.toBeNull();
        if (result) {
            // If parent returns early, we get only parent in routes list
            // If child is found, we should get both
            // Index route means we want to render Parent AND Child
            expect(result.routes).toHaveLength(2);
            expect(result.routes[1]).toBe(childRoute);
        }
    });
});
