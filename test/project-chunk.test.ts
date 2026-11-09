import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkJava, classify, maskJava } from '../lib/projects/chunk.ts'

const filler = Array.from({ length: 50 }, (_, i) => `    // filler ${i}`).join('\n')
const SRC = `package com.acme.orders;

import java.util.List;
import org.springframework.web.bind.annotation.*;

/** Orders API. */
@RestController
@RequestMapping("/orders")
public class OrderController {
    private final OrderService service;
    private final Runnable hook = () -> { System.out.println("}"); };
    private final Comparator<Order> cmp = new Comparator<Order>() {
        public int compare(Order a, Order b) { return 0; }
    };

    public OrderController(OrderService service) { this.service = service; }

    /** Lists orders; braces in "{strings}" must not confuse the scanner. */
    @GetMapping
    public List<Order> list(@RequestParam(defaultValue = "0") int page) {
        if (page < 0) { throw new IllegalArgumentException("page { < 0"); }
        return service.findAll(page);
    }

    @PostMapping("/{id}/cancel")
    public void cancel(@PathVariable long id) throws NotFoundException {
        service.cancel(id);
    }

    public void cancel(long id, String reason) {
        service.cancel(id, reason);
    }

    static class Helper {
        void help() {}
    }
${filler}
}
`

test('classify picks Spring Boot sources and skips the rest', () => {
  assert.equal(classify('src/main/java/a/B.java'), 'code')
  assert.equal(classify('src/test/java/a/BTest.java'), 'test')
  assert.equal(classify('src/main/resources/application-dev.yml'), 'config')
  assert.equal(classify('pom.xml'), 'config')
  assert.equal(classify('src/main/resources/db/migration/V1__init.sql'), 'sql')
  assert.equal(classify('src/main/resources/static/app.js'), null)
})

test('masking keeps offsets and hides braces in strings and comments', () => {
  const s = 'a("{") /* } */ b // {\nc'
  const m = maskJava(s)
  assert.equal(m.length, s.length)
  assert.equal(m.includes('{'), false)
  assert.equal(m.includes('}'), false)
  assert.equal(m.split('\n').length, 2)
})

test('a Java class becomes a summary plus one chunk per method', () => {
  const chunks = chunkJava('src/main/java/com/acme/orders/OrderController.java', SRC, 'code')
  const symbols = chunks.map((c) => c.symbol)
  assert.deepEqual(symbols, [
    'OrderController (outline)',
    'OrderController.OrderController',
    'OrderController.list',
    'OrderController.cancel',
    'OrderController.cancel',
    'OrderController.Helper',
  ])
  // Overloads get distinct keys.
  assert.equal(new Set(chunks.map((c) => c.key)).size, chunks.length)
  const list = chunks.find((c) => c.symbol === 'OrderController.list')!
  assert.match(list.text, /^\/\*\* Lists orders/)       // javadoc stays with its method
  assert.match(list.text, /@GetMapping/)                // so do annotations
  assert.match(list.text, /return service\.findAll\(page\);\n    }$/)
  assert.equal(list.startLine, 18)
  const summary = chunks[0]!
  assert.match(summary.text, /@RequestMapping\("\/orders"\)/)
  assert.match(summary.text, /public void cancel\(@PathVariable long id\) throws NotFoundException \{ … \}/)
  assert.doesNotMatch(summary.text, /^import /m)
  assert.doesNotMatch(summary.text, /service\.findAll/)  // bodies left out of the summary
})

test('a small file stays whole', () => {
  const c = chunkJava('A.java', 'public class A { void x() {} }', 'code')
  assert.equal(c.length, 1)
  assert.equal(c[0]!.symbol, 'A')
})
