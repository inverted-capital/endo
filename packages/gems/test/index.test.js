import test from '@endo/ses-ava/prepare-endo.js';
import '@agoric/swingset-liveslots/tools/setup-vat-data.js';
import { E } from '@endo/captp';
import { makeKernelFactory } from './util.js';

const { restart, clear } = makeKernelFactory();

test.afterEach(async t => {
  await clear();
});

test.serial('persistence - simple json counter', async t => {
  const recipe = `${({ M, name }) => ({
    interfaceGuards: M.interface(name, {
      increment: M.call().returns(M.number()),
      getCount: M.call().returns(M.number()),
    }),
    initFn: (count = 0) => ({ count }),
    methods: {
      increment() {
        this.state.count += 1;
        return this.state.count;
      },
      getCount() {
        return this.state.count;
      },
    },
  })}`;

  let { kernel } = await restart();

  const makeCounter = kernel.vatSupervisor.registerClass('Counter', recipe);
  let counter = makeCounter(3);
  kernel.store.init('counter', counter);

  t.deepEqual(counter.getCount(), 3);
  counter.increment();
  t.deepEqual(counter.getCount(), 4);

  ({ kernel } = await restart());
  counter = kernel.store.get('counter');

  t.deepEqual(counter.getCount(), 4);
  counter.increment();
  counter.increment();
  t.deepEqual(counter.getCount(), 6);
});

// TODO: need to untangle captp remote refs for persistence
test.serial('persistence - exo refs in state', async t => {
  const friendsListRecipe = `${({ M, name }) => ({
    interfaceGuards: M.interface(name, {
      addFriend: M.call(M.any()).returns(M.string()),
      getFriends: M.call().returns(M.any()),
    }),
    initFn: () => harden({ friends: [] }),
    methods: {
      addFriend(friend) {
        this.state.friends = harden([...this.state.friends, friend]);
        return `added friend ${friend} (${this.state.friends.length} friends total)`;
      },
      getFriends() {
        return this.state.friends;
      },
    },
  })}`;

  const friendRecipe = `${() => ({
    methods: {},
  })}`;

  let { kernel } = await restart();

  const makeFriendsList = kernel.vatSupervisor.registerClass(
    'FriendsList',
    friendsListRecipe,
  );
  let friendsList = makeFriendsList();
  kernel.store.init('friendsList', friendsList);
  const makeFriend = kernel.vatSupervisor.registerClass('Friend', friendRecipe);
  let friend = makeFriend();
  kernel.store.init('friend', friend);

  t.deepEqual(friendsList.getFriends(), []);
  friendsList.addFriend(friend);
  t.deepEqual(friendsList.getFriends(), [friend]);

  ({ kernel } = await restart());
  friendsList = kernel.store.get('friendsList');
  friend = kernel.store.get('friend');

  t.deepEqual(friendsList.getFriends(), [friend]);
});

test.serial('persistence - cross-vat refs in state', async t => {
  const friendsListRecipe = `${({ M, name }) => ({
    interfaceGuards: M.interface(name, {
      addFriend: M.call(M.any()).returns(M.string()),
      getFriends: M.call().returns(M.any()),
    }),
    initFn: () => harden({ friends: [] }),
    methods: {
      addFriend(friend) {
        this.state.friends = harden([...this.state.friends, friend]);
        return `added friend ${friend} (${this.state.friends.length} friends total)`;
      },
      getFriends() {
        return this.state.friends;
      },
    },
  })}`;

  const friendRecipe = `${() => ({
    methods: {
      greet() {
        return 'hello';
      },
    },
  })}`;

  let { kernel } = await restart();

  const makeFriendsList = kernel.vatSupervisor.registerClass(
    'FriendsList',
    friendsListRecipe,
  );
  let friendsList = makeFriendsList();
  kernel.store.init('friendsList', friendsList);

  let foreignFriend = await E(kernel.workerFacet).incubate(`
    const recipe = ${JSON.stringify(friendRecipe)};
    const makeFriend = registerClass('Friend', recipe);
    makeFriend();
  `);
  kernel.store.init('friend', foreignFriend);
  t.deepEqual(await E(foreignFriend).greet(), 'hello');

  t.deepEqual(friendsList.getFriends(), []);
  friendsList.addFriend(foreignFriend);
  t.deepEqual(friendsList.getFriends(), [foreignFriend]);

  ({ kernel } = await restart());
  friendsList = kernel.store.get('friendsList');
  // NOTE: this friend is a promise for a presence,
  // despite the presence being directly put into the store
  foreignFriend = kernel.store.get('friend');
  t.deepEqual(await E(foreignFriend).greet(), 'hello');

  t.deepEqual(friendsList.getFriends(), [foreignFriend]);
});

test.serial('registerIncubation - defineClass', async t => {
  const incubationCode = `(${() => {
    const makePingPong = defineClass('PingPong', {
      interfaceGuards: M.interface('PingPong', {
        ping: M.call().returns(M.string()),
      }),
      initFn: () => harden({}),
      methods: {
        ping() {
          return 'pong';
        },
      },
    });

    if (firstTime) {
      return makePingPong();
    }
  }})()`;

  let { kernel } = await restart();

  let pingPong = kernel.vatSupervisor.registerIncubation(
    'PingPong',
    incubationCode,
  );
  kernel.store.init('pingPong', pingPong);

  t.deepEqual(pingPong.ping(), 'pong');

  ({ kernel } = await restart());

  pingPong = kernel.store.get('pingPong');
  t.deepEqual(pingPong.ping(), 'pong');
});

// Need a way of creating a class that uses another class -- maybe exoClassKit?
// maybe putting makeNewInstance fn in the store?
test.skip('persistence - widget factory', async t => {
  const widgetFactoryRecipe = `${({
    M,
    gemName,
    registerChildClass,
    lookupChildGemClass,
  }) => {
    registerChildClass({
      name: 'Widget',
      code: `${({ M: M2 }) => ({
        interface: M2.interface('Widget', {
          sayHi: M2.call().returns(M2.string()),
        }),
        methods: {
          sayHi() {
            return 'hi im a widget';
          },
        },
      })}`,
    });
    return {
      interface: M.interface(gemName, {
        makeWidget: M.call().returns(M.any()),
      }),
      methods: {
        makeWidget() {
          const makeWidget = lookupChildGemClass('Widget');
          return makeWidget();
        },
      },
    };
  }}`;

  let kernel = restart();
  let widgetFactory = kernel.makeGem('WidgetFactory', widgetFactoryRecipe);
  kernel.store.init('widgetFactory', widgetFactory);

  let widget = widgetFactory.makeWidget();
  kernel.store.init('widget', widget);

  t.deepEqual(widget.sayHi(), 'hi im a widget');

  kernel = restart();
  widgetFactory = kernel.store.get('widgetFactory');
  widget = kernel.store.get('widget');

  t.deepEqual(widget.sayHi(), 'hi im a widget');
  const widget2 = widgetFactory.makeWidget();
  kernel.store.init('widget2', widget2);
  t.deepEqual(widget2.sayHi(), 'hi im a widget');

  t.pass();
});
