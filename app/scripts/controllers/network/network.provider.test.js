import EthQuery from 'eth-query';
import nock from 'nock';
import NetworkController from './network';

describe('NetworkController provider tests', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  describe('if NetworkController is configured with an Infura network', () => {
    const infuraProjectId = 'abc123';
    const latestBlockNumber = '0x1';

    function mockInfuraRequestsForProbeAndBlockTracker(network = 'mainnet') {
      const latestBlockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: latestBlockNumber,
      };
      return nock(`https://${network}.infura.io:443`)
        .filteringRequestBody((body) => {
          const copyOfBody = JSON.parse(body);
          // some ids are random, so remove them entirely from the request to
          // make it possible to mock these requests
          delete copyOfBody.id;
          return JSON.stringify(copyOfBody);
        })
        .post(`/v3/${infuraProjectId}`, {
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
        })
        .times(3)
        .reply(200, latestBlockResponse)
        .post(`/v3/${infuraProjectId}`, {
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: [latestBlockNumber, false],
        })
        .reply(200, latestBlockResponse)
        .post(`/v3/${infuraProjectId}`, {
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: ['latest', false],
        })
        .reply(200, latestBlockResponse);
    }

    function buildControllerConnectedToInfuraNetwork(network = 'mainnet') {
      const controller = new NetworkController();
      controller.setInfuraProjectId(infuraProjectId);
      controller.initializeProvider({
        getAccounts() {
          // do nothing for now
        },
      });
      controller.setProviderConfig({ type: network });
      return controller;
    }

    function getEthQueryConnectedToInfuraNetwork(network = 'mainnet') {
      const controller = buildControllerConnectedToInfuraNetwork(network);
      const { provider } = controller.getProviderAndBlockTracker();
      return new EthQuery(provider);
    }

    describe('as long as a middleware that is not our Infura middleware is not intercepting the request', () => {
      function mockRpcMethodCall(scope, rpcMethod, params = []) {
        return scope.post(`/v3/${infuraProjectId}`, {
          jsonrpc: '2.0',
          method: rpcMethod,
          params,
        });
      }

      function mockArbitraryRpcMethodCall(scope) {
        return mockRpcMethodCall(scope, 'arbitraryRpcMethod');
      }

      function callRpcMethod(ethQuery, rpcMethod, params = []) {
        return new Promise((resolve, reject) => {
          ethQuery.sendAsync({ method: rpcMethod, params }, (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          });
        });
      }

      function callArbitraryRpcMethod(ethQuery) {
        return callRpcMethod(ethQuery, 'arbitraryRpcMethod');
      }

      beforeEach(() => {
        const originalSetTimeout = global.setTimeout;
        jest.spyOn(global, 'setTimeout').mockImplementation((fn, _timeout) => {
          return originalSetTimeout(fn, 0);
        });
      });

      describe('when the RPC method is anything', () => {
        it('throws a specific error message if the response from Infura is a 405', async () => {
          const scope = mockInfuraRequestsForProbeAndBlockTracker();
          const ethQuery = getEthQueryConnectedToInfuraNetwork();
          mockArbitraryRpcMethodCall(scope).reply(405);

          await expect(() => callArbitraryRpcMethod(ethQuery)).rejects.toThrow(
            'The method does not exist / is not available.',
          );
        });

        it('throws a specific error message if the response from Infura is a 429', async () => {
          const scope = mockInfuraRequestsForProbeAndBlockTracker();
          const ethQuery = getEthQueryConnectedToInfuraNetwork();
          mockArbitraryRpcMethodCall(scope).reply(429);

          await expect(() => callArbitraryRpcMethod(ethQuery)).rejects.toThrow(
            'Request is being rate limited',
          );
        });

        describe('if the request to Infura responds with 503', () => {
          it('retries the request up to 5 times until Infura responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope).times(4).reply(503);
            mockArbitraryRpcMethodCall(scope).reply(200, {
              jsonrpc: '2.0',
              id: 1,
              result: 'it works',
            });

            const actualResult = await callArbitraryRpcMethod(ethQuery);

            expect(actualResult).toStrictEqual('it works');
          });

          it('throws an error if Infura never responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope).times(5).reply(503);

            await expect(() => {
              return callArbitraryRpcMethod(ethQuery);
            }).rejects.toThrow(
              /^InfuraProvider - cannot complete request\. All retries exhausted\./u,
            );
          });
        });

        describe('if the request to Infura responds with 504', () => {
          it('retries the request up to 5 times until Infura responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(
              mockArbitraryRpcMethodCall(scope).times(4).reply(504),
            ).reply(200, {
              jsonrpc: '2.0',
              id: 1,
              result: 'it works',
            });

            const actualResult = await callArbitraryRpcMethod(ethQuery);

            expect(actualResult).toStrictEqual('it works');
          });

          it('throws an error if Infura never responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope).times(5).reply(504);

            await expect(() => {
              return callArbitraryRpcMethod(ethQuery);
            }).rejects.toThrow(
              /^InfuraProvider - cannot complete request\. All retries exhausted\./u,
            );
          });
        });

        describe('if the request to Infura times out', () => {
          it('retries the request up to 5 times until Infura responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope)
              .times(4)
              .replyWithError('ETIMEDOUT: Some error message');
            mockArbitraryRpcMethodCall(scope).reply(200, {
              jsonrpc: '2.0',
              id: 1,
              result: 'it works',
            });

            const actualResult = await callArbitraryRpcMethod(ethQuery);

            expect(actualResult).toStrictEqual('it works');
          });

          it('throws an error if Infura never responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope)
              .times(5)
              .replyWithError('ETIMEDOUT: Some error message');

            await expect(() => {
              return callArbitraryRpcMethod(ethQuery);
            }).rejects.toThrow(
              /^InfuraProvider - cannot complete request\. All retries exhausted\./u,
            );
          });
        });

        describe('if a "connection reset" error is thrown while making the request to Infura', () => {
          it('retries the request up to 5 times until Infura responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope)
              .times(4)
              .replyWithError('ECONNRESET: Some error message');
            mockArbitraryRpcMethodCall(scope).reply(200, {
              jsonrpc: '2.0',
              id: 1,
              result: 'it works',
            });

            const actualResult = await callArbitraryRpcMethod(ethQuery);

            expect(actualResult).toStrictEqual('it works');
          });

          it('throws an error if the request never responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope)
              .times(5)
              .replyWithError('ECONNRESET: Some error message');

            await expect(() => {
              return callArbitraryRpcMethod(ethQuery);
            }).rejects.toThrow(
              /^InfuraProvider - cannot complete request\. All retries exhausted\./u,
            );
          });
        });

        describe('if the request to Infura responds with HTML or something else that is non-JSON-parseable', () => {
          it('retries the request up to 5 times until Infura returns something JSON-parseable', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope)
              .times(4)
              .reply('<html><p>Some error message</p></html>');
            mockArbitraryRpcMethodCall(scope).reply(200, {
              jsonrpc: '2.0',
              id: 1,
              result: 'it works',
            });

            const actualResult = await callArbitraryRpcMethod(ethQuery);

            expect(actualResult).toStrictEqual('it works');
          });

          it('throws an error if Infura never responds with 2xx', async () => {
            const scope = mockInfuraRequestsForProbeAndBlockTracker();
            const ethQuery = getEthQueryConnectedToInfuraNetwork();
            mockArbitraryRpcMethodCall(scope)
              .times(5)
              .reply('<html><p>Some error message</p></html>');

            await expect(() => {
              return callArbitraryRpcMethod(ethQuery);
            }).rejects.toThrow(
              /^InfuraProvider - cannot complete request\. All retries exhausted\./u,
            );
          });
        });
      });

      describe('when the RPC method is "eth_chainId"', () => {
        it('does not hit Infura, instead responding with the chain id that maps to the Infura network', async () => {
          mockInfuraRequestsForProbeAndBlockTracker();
          const ethQuery = getEthQueryConnectedToInfuraNetwork('ropsten');

          const chainId = await callRpcMethod(ethQuery, 'eth_chainId');

          expect(chainId).toStrictEqual('0x4');
        });
      });

      describe('when the RPC method is "net_version"', () => {
        it('does not hit Infura, instead responding with the Infura network', async () => {
          mockInfuraRequestsForProbeAndBlockTracker('ropsten');
          const ethQuery = getEthQueryConnectedToInfuraNetwork('ropsten');

          const network = await callRpcMethod(ethQuery, 'net_version');

          expect(network).toStrictEqual('ropsten');
        });
      });

      describe('when the RPC method is "eth_getBlockByNumber"', () => {
        it('overrides the result with null when the response from Infura is 2xx but the response text is "Not Found"', async () => {
          const scope = mockInfuraRequestsForProbeAndBlockTracker();
          const ethQuery = getEthQueryConnectedToInfuraNetwork();
          // Question: Why does this get called twice when we only call it once?
          mockRpcMethodCall(scope, 'eth_getBlockByNumber', [
            latestBlockNumber,
          ]).reply(200, 'Not Found');
          mockRpcMethodCall(scope, 'eth_getBlockByNumber', []).reply(
            200,
            'Not Found',
          );

          const actualResult = await callRpcMethod(
            ethQuery,
            'eth_getBlockByNumber',
          );

          expect(actualResult).toBeNull();
        });
      });
    });
  });
});
